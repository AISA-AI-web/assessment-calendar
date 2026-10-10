'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fresh, call } = require('./harness');

const g = load();

function sid(t, course) { return t.fx.courses[course].section_id; }

function draft(t, course, date, extra) {
  return Object.assign({
    title: 'Cells unit test', category: 'SUMMATIVE', format: 'Test', notes: 'Bring a calculator.',
    announced: true, rows: [{ sectionId: sid(t, course), date, periods: [] }]
  }, extra || {});
}

function gradeEvents(t, grade) { return t.svc.events('grade' + grade + '@fake'); }

test('a clear booking is saved, counted and copied to the grade calendar', () => {
  const t = fresh();
  const res = call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27'));
  assert.equal(res.ok, true, JSON.stringify(res.error));
  assert.equal(res.data.status, 'ACTIVE');
  const e = res.data.entries[0];
  assert.equal(e.teacherEmail, t.fx.people.teacher);
  assert.equal(e.mine, true);
  const copies = gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title));
  assert.equal(copies.length, 1);
  assert.equal(copies[0].startDate, '2026-10-27');
  assert.match(copies[0].title, /^Summative: Biology 9 Boys \(B09BIO\.1\) – Cells unit test$/);
  assert.match(copies[0].description, /Managed by the Assessment Calendar/);
  const row = t.backend.objects('Assessments').find((r) => r.id === e.id);
  assert.equal(row.mirror_status, 'OK');
  assert.ok(t.backend.objects('Log').some((l) => l.action === 'CREATE'));
});

test('periods turn the calendar copy into a timed event', () => {
  const t = fresh();
  const res = call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27', { rows: [{ sectionId: sid(t, 'B09BIO'), date: '2026-10-27', periods: ['3', '4'] }] }));
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const copy = gradeEvents(t, '9').find((x) => /Cells unit test/.test(x.title));
  assert.equal(copy.allDay, false);
  assert.equal(copy.startTime, '09:45');
  assert.equal(copy.endTime, '11:50');
});

test('a teacher cannot book a third summative, but can ask SLT, who approves it', () => {
  const t = fresh();
  const blocked = call(g, 'apiCreate', draft(t, 'G09BIO', '2026-10-27'));
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, 'BLOCKED');
  assert.equal(blocked.error.details.evaluation.rows[0].affected.count, 18);

  const asked = call(g, 'apiCreate', draft(t, 'G09BIO', '2026-10-27', { requestReason: 'Lab booked weeks ago; only day it is free.' }));
  assert.equal(asked.ok, true, JSON.stringify(asked.error));
  assert.equal(asked.data.status, 'PENDING');
  const id = asked.data.entries[0].id;
  assert.equal(gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title)).length, 0, 'pending entries are not copied');
  const mail = t.svc.state.mail.pop();
  assert.match(mail.subject, /^Approval needed: Cells unit test/);
  assert.ok(mail.to.split(',').includes('tl.head@school.example'));
  assert.match(mail.body, /Lab booked weeks ago/);

  // Pending does not count: the grade 9 girls still have 2 on that day.
  let range = call(g, 'apiGetRange', { start: '2026-10-26', end: '2026-10-30', scope: 'grade:9' });
  assert.equal(range.data.load.days['2026-10-27'].max, 2);
  assert.ok(range.data.entries.some((e) => e.id === id && e.status === 'PENDING'));

  t.as(t.fx.people.slt);
  const pending = call(g, 'apiPending');
  assert.equal(pending.ok, true);
  const mine = pending.data.find((p) => p.id === id);
  assert.ok(mine.check.issues.some((i) => i.code === 'DAY_CAP'));

  const approved = call(g, 'apiDecide', { id, approve: true, note: 'Fine this once.' });
  assert.equal(approved.ok, true, JSON.stringify(approved.error));
  assert.equal(approved.data.status, 'ACTIVE');
  assert.equal(gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title)).length, 1);
  const toTeacher = t.svc.state.mail.pop();
  assert.equal(toTeacher.to, t.fx.people.teacher);
  assert.match(toTeacher.subject, /^Approved:/);

  range = call(g, 'apiGetRange', { start: '2026-10-26', end: '2026-10-30', scope: 'grade:9' });
  assert.equal(range.data.load.days['2026-10-27'].max, 3);
  assert.equal(range.data.load.days['2026-10-27'].over, 18);

  const again = call(g, 'apiDecide', { id, approve: false });
  assert.equal(again.error.code, 'CONFLICT');
});

test('a declined request can be moved and saved again', () => {
  const t = fresh();
  const asked = call(g, 'apiCreate', draft(t, 'G09BIO', '2026-10-27', { requestReason: 'Only lab slot available.' }));
  const id = asked.data.entries[0].id;
  t.as(t.fx.people.slt);
  const declined = call(g, 'apiDecide', { id, approve: false, note: 'Try the following week.' });
  assert.equal(declined.data.status, 'DECLINED');
  t.as(t.fx.people.teacher);
  const sec = g.Dir.section(sid(t, 'G09BIO'));
  const free = g.Rules.suggest({ sectionId: sec.id, date: '2026-10-27' }, sec, sec.grades, 'SUMMATIVE', g.Entries.all(), {}, 1)[0];
  const moved = call(g, 'apiUpdate', { id, patch: { date: free.date, periods: free.periods } });
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  assert.equal(moved.data.status, 'ACTIVE');
  assert.equal(moved.data.entry.date, free.date);
});

test('SLT can override a block only with a reason', () => {
  const t = fresh({ user: 'tl.head@school.example' });
  const noReason = call(g, 'apiCreate', draft(t, 'G09ART', '2026-10-27', { title: 'Portfolio review' }));
  assert.equal(noReason.error.code, 'NEEDS_OVERRIDE');
  const withReason = call(g, 'apiCreate', draft(t, 'G09ART', '2026-10-27', { title: 'Portfolio review', overrideReason: 'External moderator visit.' }));
  assert.equal(withReason.ok, true, JSON.stringify(withReason.error));
  assert.equal(withReason.data.status, 'ACTIVE');
  assert.equal(withReason.data.entries[0].overrideBy, 'tl.head@school.example');
  // SLT books on behalf of the class teacher.
  assert.notEqual(withReason.data.entries[0].teacherEmail, 'tl.head@school.example');
});

test('nobody can book a closed day, not even SLT', () => {
  const t = fresh({ user: 'tl.head@school.example' });
  const res = call(g, 'apiCreate', draft(t, 'G09ART', '2026-10-14', { overrideReason: 'Please' }));
  assert.equal(res.error.code, 'INVALID');
  assert.match(res.error.message, /no school/i);
});

test('students see only their own announced entries, without staff details', () => {
  const t = fresh();
  call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-28', { title: 'Unannounced boys test', announced: false }));
  t.as(t.fx.people.student);
  const boot = call(g, 'apiBootstrap');
  assert.equal(boot.data.user.role, 'STUDENT');
  assert.equal(boot.data.user.canBook, false);
  assert.ok(boot.data.sections.every((s) => s.mine));
  assert.ok(boot.data.calendar.events.every((e) => e.category !== 'DEADLINE'));
  const range = call(g, 'apiGetRange', { start: '2026-10-26', end: '2026-12-04', scope: 'grade:10' });
  assert.equal(range.data.scope.key, 'me');
  const titles = range.data.entries.map((e) => e.title);
  assert.ok(titles.includes('Persuasive essay'));
  assert.ok(!titles.includes('Unannounced boys test'));
  assert.ok(range.data.entries.every((e) => e.announced && e.status === 'ACTIVE'));
  for (const e of range.data.entries) {
    assert.equal(e.notes, undefined);
    assert.equal(e.teacherEmail, undefined);
    assert.equal(e.requestReason, undefined);
  }
  assert.equal(range.data.load.days['2026-10-27'].max, 2);

  assert.equal(call(g, 'apiCreate', draft(t, 'G09BIO', '2026-11-17')).error.code, 'FORBIDDEN');
  assert.equal(call(g, 'apiEvaluate', draft(t, 'G09BIO', '2026-11-17')).error.code, 'FORBIDDEN');
  assert.equal(call(g, 'apiPending').error.code, 'FORBIDDEN');
});

test('a student does not see an entry until it is announced', () => {
  const t = fresh();
  const made = call(g, 'apiCreate', draft(t, 'G09BIO', '2026-11-04', { title: 'Enzyme practical', category: 'FORMATIVE', announced: false }));
  const id = made.data.entries[0].id;
  t.as(t.fx.people.student);
  let list = call(g, 'apiGetRange', { start: '2026-11-02', end: '2026-11-06' });
  assert.ok(!list.data.entries.some((e) => e.id === id));
  t.as(t.fx.people.teacher);
  assert.equal(call(g, 'apiUpdate', { id, patch: { announced: true } }).ok, true);
  t.as(t.fx.people.student);
  list = call(g, 'apiGetRange', { start: '2026-11-02', end: '2026-11-06' });
  assert.ok(list.data.entries.some((e) => e.id === id));
});

test('viewers can look but not book; strangers get no access', () => {
  const t = fresh({ user: 'counsellor@school.example' });
  assert.equal(call(g, 'apiGetRange', { start: '2026-10-26', end: '2026-10-30' }).ok, true);
  assert.equal(call(g, 'apiCreate', draft(t, 'G09BIO', '2026-11-17')).error.code, 'FORBIDDEN');
  t.as('stranger@school.example');
  assert.equal(call(g, 'apiBootstrap').error.code, 'NO_ACCESS');
});

test('a class view shows everything its students have, including other subjects', () => {
  const t = fresh();
  const res = call(g, 'apiGetRange', { start: '2026-10-26', end: '2026-10-30', scope: 'section:' + sid(t, 'G09BIO') });
  const titles = res.data.entries.map((e) => e.title);
  assert.ok(titles.includes('Persuasive essay'));
  assert.ok(titles.includes('Unit 3 test: linear functions'));
  assert.ok(!titles.includes('Poetry analysis'), 'a Grade 10 boys entry does not belong here');
  assert.equal(res.data.load.days['2026-10-27'].max, 2);
});

test('moving an entry updates its calendar copy; deleting removes it', () => {
  const t = fresh();
  const made = call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27'));
  const id = made.data.entries[0].id;
  const moved = call(g, 'apiUpdate', { id, patch: { date: '2026-10-28', periods: ['1'] } });
  assert.equal(moved.ok, true, JSON.stringify(moved.error));
  let copies = gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title));
  assert.equal(copies.length, 1);
  assert.equal(copies[0].startDate, '2026-10-28');
  assert.equal(copies[0].startTime, '07:55');
  assert.equal(call(g, 'apiDelete', { id }).ok, true);
  copies = gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title));
  assert.equal(copies.length, 0);
  const row = t.backend.objects('Assessments').find((r) => r.id === id);
  assert.equal(row.status, 'CANCELLED');
});

test('teachers cannot change other people\'s entries or past entries', () => {
  const t = fresh();
  const theirs = t.backend.objects('Assessments').find((r) => r.title === 'Persuasive essay');
  const denied = call(g, 'apiUpdate', { id: theirs.id, patch: { title: 'Mine now' } });
  assert.equal(denied.error.code, 'FORBIDDEN');
  const made = call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27'));
  t.svc.state.today = '2026-10-28';
  const late = call(g, 'apiUpdate', { id: made.data.entries[0].id, patch: { title: 'Renamed' } });
  assert.equal(late.error.code, 'FORBIDDEN');
});

test('only announced entries are copied when the grade calendars are not staff-only', () => {
  const t = fresh({
    tables: {
      Settings: [{ key: 'internal_calendar_id', value: 'internal@fake' }, { key: 'mirror_unannounced', value: 'FALSE' }]
        .concat(['6', '7', '8', '9', '10', '11', '12'].map((x) => ({ key: 'grade_calendar_' + x, value: 'grade' + x + '@fake' })))
    }
  });
  const made = call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27', { announced: false }));
  assert.equal(gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title)).length, 0);
  call(g, 'apiUpdate', { id: made.data.entries[0].id, patch: { announced: true } });
  assert.equal(gradeEvents(t, '9').filter((x) => /Cells unit test/.test(x.title)).length, 1);
});

test('a failed copy is recorded and retried by the hourly job', () => {
  const t = fresh({
    tables: {
      Settings: [{ key: 'internal_calendar_id', value: 'internal@fake' }, { key: 'grade_calendar_9', value: 'missing@fake' }]
    }
  });
  const made = call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27'));
  assert.equal(made.ok, true, 'the save itself succeeds');
  let row = t.backend.objects('Assessments').find((r) => r.id === made.data.entries[0].id);
  assert.match(row.mirror_status, /^ERROR/);
  t.svc.addCalendar('missing@fake', 'Late calendar', []);
  g.Store.invalidate();
  g.Entries.reset();
  const r = g.Mirror.retryFailed();
  assert.ok(r.synced >= 1);
  row = t.backend.objects('Assessments').find((x) => x.id === made.data.entries[0].id);
  assert.equal(row.mirror_status, 'OK');
  // The retry also back-fills every older Grade 9 entry onto the calendar that is now reachable.
  const copies = t.svc.events('missing@fake');
  assert.equal(copies.filter((e) => /Cells unit test/.test(e.title)).length, 1);
  assert.equal(copies.length, r.synced);
  assert.equal(g.Mirror.retryFailed().synced, 0, 'nothing left to do');
});

test('old grade-calendar events: claim one (the event is taken over), ignore another', () => {
  const t = fresh();
  const list = call(g, 'apiImports');
  assert.deepEqual(list.data.map((i) => i.id), ['I1', 'I2']);
  assert.deepEqual(list.data[1].periods, ['3']);
  const claim = call(g, 'apiCreate', {
    importId: 'I2', title: 'Cells test', category: 'SUMMATIVE', announced: true,
    rows: [{ sectionId: sid(t, 'B09BIO'), date: '2026-11-05', periods: ['3'] }]
  });
  assert.equal(claim.ok, true, JSON.stringify(claim.error));
  const old = gradeEvents(t, '9').find((e) => e.id === 'old-g9-2@fake');
  assert.match(old.title, /^Summative: Biology 9 Boys/);
  const q = t.backend.objects('ImportQueue');
  assert.equal(q.find((r) => r.import_id === 'I2').status, 'CLAIMED');
  assert.equal(call(g, 'apiIgnoreImport', { id: 'I1' }).ok, true);
  assert.equal(t.backend.objects('ImportQueue').find((r) => r.import_id === 'I1').status, 'IGNORED');
  assert.ok(gradeEvents(t, '9').some((e) => e.id === 'old-g9-1@fake'), 'ignored events are left alone');
  assert.equal(call(g, 'apiImports').data.length, 0);
  // Someone else cannot claim it.
  t.as(t.fx.people.historyTeacher);
  const other = call(g, 'apiCreate', { importId: 'I1', title: 'x', category: 'FORMATIVE', rows: [{ sectionId: sid(t, 'B10HIST'), date: '2026-11-05', periods: [] }] });
  assert.equal(other.ok, false);
});

test('importing from the grade calendars queues only events the app does not know', () => {
  const t = fresh({ user: 'admin@school.example' });
  call(g, 'apiCreate', draft(t, 'B09BIO', '2026-10-27', { overrideReason: 'n/a' }));
  g.Store.invalidate();
  g.Entries.reset();
  const before = t.backend.objects('ImportQueue').length;
  t.svc.state.calendars['grade9@fake'].events['new@fake'] = {
    id: 'new@fake', title: 'Eng (9) Summative', description: '', allDay: true,
    startDate: '2026-11-18', endDate: '2026-11-20', startTime: '', endTime: '', creators: ['someone@school.example']
  };
  const r = g.Mirror.importExisting();
  assert.equal(r.added, 1);
  const added = t.backend.objects('ImportQueue').slice(before);
  assert.equal(added[0].guess_category, 'SUMMATIVE');
  assert.equal(added[0].end_date, '2026-11-19');
  assert.equal(g.Mirror.importExisting().added, 0, 'running it again adds nothing');
});

test('Set up creates every tab and seeds defaults without overwriting', () => {
  const t = fresh({ user: 'new.admin@school.example', tables: { Settings: [{ key: 'max_summatives_per_day', value: '3' }] }, sync: false });
  t.backend.db = { Settings: t.backend.db.Settings };
  g.Store.invalidate();
  t.svc.state.calendars = { 'internal-real@fake': { name: 'AISA (Internal Calendar)', events: {} } };
  const r = g.Setup.run();
  assert.ok(r.created.includes('Assessments'));
  assert.equal(r.internalCalendarFound, true);
  const settings = t.backend.objects('Settings');
  assert.equal(settings.find((s) => s.key === 'max_summatives_per_day').value, '3');
  assert.equal(settings.find((s) => s.key === 'internal_calendar_id').value, 'internal-real@fake');
  assert.equal(t.backend.objects('Bells').length, 11);
  assert.ok(t.backend.objects('CalendarRules').length >= 8);
  assert.equal(t.backend.objects('Staff')[0].role, 'ADMIN');
});

test('unexpected server errors come back as a plain message', () => {
  fresh();
  const res = JSON.parse(JSON.stringify(g.Api.run(() => { throw new Error('boom'); })));
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'ERROR');
  assert.doesNotMatch(res.error.message, /boom/);
});
