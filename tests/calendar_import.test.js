'use strict';

// What is already on the grade calendars goes straight onto the app's calendar.

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fresh, call } = require('./harness');

const g = load();
const ADMIN = 'admin@school.example';

function sid(t, course) { return t.fx.courses[course].section_id; }

function gradeEvents(t, grade) { return t.svc.events('grade' + grade + '@fake'); }

function addEvent(t, grade, ev) {
  t.svc.state.calendars['grade' + grade + '@fake'].events[ev.id] = Object.assign({
    description: '', allDay: true, startTime: '', endTime: '', creators: [t.fx.people.teacher]
  }, ev, { endDate: ev.endDate || g.U.addDays(ev.startDate, ev.allDay === false ? 0 : 1) });
}

function imported(title) {
  g.Entries.reload();
  return g.Entries.all().filter((e) => e.source === 'CALENDAR' && (!title || title.test(e.title)));
}

test('old grade-calendar events become entries straight away, matched to their classes', () => {
  const t = fresh({ user: ADMIN });
  const r = g.Mirror.importExisting();
  assert.equal(r.events, 2);
  assert.equal(r.counted, 1, 'the summative counts; the formative never does');
  assert.equal(r.unmatched, 0);
  assert.ok(t.backend.objects('ImportQueue').every((x) => x.status === 'IMPORTED' && x.assessment_ids));

  const cells = imported(/cells/)[0];
  assert.equal(cells.section_id, sid(t, 'B09BIO'), '"B9" in the title is B09BIO, not G09BIO');
  assert.equal(cells.category, 'SUMMATIVE');
  assert.deepEqual(cells.periods, ['3'], '09:45–10:35 is P3');
  assert.equal(cells.status, 'ACTIVE');
  assert.equal(cells.announced, false, 'students see it once the teacher announces it');
  assert.equal(cells.mirror_status, 'SOURCE');
  assert.match(cells.notes, /^From the Grade 9 assessment calendar, posted by Felix Brandt\./);
  assert.ok(g.Rules.studentsOf(cells).length > 0, 'it counts for the class');

  const girls = imported(/Girls Biology/)[0];
  assert.equal(girls.section_id, sid(t, 'G09BIO'), 'Girls + Biology');
  assert.equal(girls.category, 'FORMATIVE');

  const week = call(g, 'apiGetRange', { start: '2026-11-02', end: '2026-11-06', scope: 'grade:9' });
  assert.ok(week.data.entries.some((e) => e.id === cells.id), 'on the calendar for staff');
  assert.equal(gradeEvents(t, '9').length, 2, 'nothing is copied back');
  assert.ok(gradeEvents(t, '9').every((e) => !/^Summative:/.test(e.title)), 'the teachers\' events are left as they were');
  assert.equal(g.Mirror.importExisting().events, 0, 'running it again adds nothing');
});

test('what the app cannot place shows for the grade and counts for nobody', () => {
  const t = fresh({ user: ADMIN });
  addEvent(t, '9', { id: 'm1@fake', title: 'Mystery summative', startDate: '2026-11-12', creators: ['visitor@school.example'] });
  addEvent(t, '9', { id: 'm2@fake', title: 'Deadline: course changes', startDate: '2026-11-16' });
  addEvent(t, '9', { id: 'm3@fake', title: 'Exam ordering window', startDate: '2026-11-02', endDate: '2026-11-25' });
  const r = g.Mirror.importExisting();
  assert.equal(r.unmatched, 3);
  const u = g.Dir.userFor(ADMIN);
  const mystery = imported(/Mystery/)[0];
  assert.equal(mystery.section_id, '');
  assert.equal(mystery.grade, '9');
  assert.equal(mystery.category, 'SUMMATIVE');
  assert.deepEqual(g.Rules.studentsOf(mystery), [], 'not counted for anyone');
  assert.equal(g.Entries.project(mystery, u).label, 'Grade 9 (class not known)');
  assert.match(mystery.notes, /could not tell which class/);
  const deadline = imported(/Deadline/)[0];
  assert.equal(deadline.category, 'FORMATIVE');
  assert.equal(deadline.section_id, '', 'no assessment word: a notice, even though its poster teaches Grade 9');
  assert.match(deadline.notes, /does not say it is an assessment/);
  const windowed = imported(/window/)[0];
  assert.equal(windowed.category, 'FORMATIVE', '"Exam", but three weeks long');
  assert.match(windowed.notes, /It runs to .*more than a week/);
});

test('posts for the same day and the same classes share them out, one class each', () => {
  const t = fresh({ user: ADMIN });
  const headers = ['[1]student_number', 'StudentEmail', '[1]Grade_Level', '[5]Email_Addr', '[5]LastFirst', '[2]Course_Name',
    'Course_Number', 'Section_Number', 'SectionID', 'Expression', 'TermID', 'DateEnrolled', 'DateLeft'];
  const row = (sid, sec, num, teacher) => [sid, sid + '@school.example', '11', teacher + '@school.example', 'Chem, ' + teacher,
    'Chemistry', 'GCHE', num, sec, '4(A,F)', '3600', '8/21/2026', '7/10/2027'];
  t.backend.replace('Assessments', t.backend.db.Assessments.headers, []);
  t.backend.replace('Roster', headers, [
    row('8001', '9301', 'GCHE1', 'a.chem'), row('8002', '9301', 'GCHE1', 'a.chem'),
    row('8003', '9302', 'GCHE2', 'b.chem'), row('8004', '9302', 'GCHE2', 'b.chem'),
    [...row('8005', '9303', 'IB1CHESL', 'a.chem').slice(0, 5), 'IB1 Chemistry SL', 'IB1CHES', 'IB1CHESL', '9303', '5(B)', '3600', '8/21/2026', '7/10/2027']
  ]);
  assert.deepEqual(g.PsImport.process().errors, []);
  for (const room of ['215', '113']) {
    addEvent(t, '11', { id: 'chem' + room + '@fake', title: 'SA_G11 Chem. Girls_' + room, startDate: '2026-11-10', creators: ['a.chem@school.example'] });
  }
  g.Mirror.importExisting();
  const byRoom = (room) => imported(new RegExp('Girls_' + room))[0].section_id;
  assert.equal(byRoom('113'), '9301', 'the poster\'s own class goes to the first');
  assert.equal(byRoom('215'), '9302', 'and the other class to the second, not IB Chemistry');
  assert.equal(g.Rules.loadFor({ kind: 'all' }, '2026-11-10', '2026-11-10', g.Entries.all()).days['2026-11-10'].max, 1,
    'each student has one summative, not two');
});

test('imported entries follow their event until someone changes them in the app', () => {
  const t = fresh({ user: ADMIN });
  g.Mirror.importExisting();
  const events = t.svc.state.calendars['grade9@fake'].events;
  Object.assign(events['old-g9-2@fake'], { title: 'B9 Biology summative (cells, moved)', startDate: '2026-11-09', endDate: '2026-11-09' });
  delete events['old-g9-1@fake'];
  addEvent(t, '9', { id: 'new@fake', title: 'G9 Biology summative (genetics)', startDate: '2026-11-19' });

  const r = g.Mirror.syncImports();
  assert.deepEqual([r.events, r.moved, r.removed], [1, 1, 1], 'one new, one moved, one deleted');
  const cells = imported(/cells/)[0];
  assert.equal(cells.date, '2026-11-09');
  assert.equal(cells.title, 'B9 Biology summative (cells, moved)');
  assert.equal(imported(/Girls Biology/)[0].status, 'CANCELLED');
  assert.equal(imported(/genetics/)[0].section_id, sid(t, 'G09BIO'));

  // The teacher ticks "announced" in the app: the app takes the old event over.
  t.as(t.fx.people.teacher);
  const res = call(g, 'apiUpdate', { id: cells.id, patch: { announced: true } });
  assert.equal(res.ok, true, JSON.stringify(res.error));
  const copies = gradeEvents(t, '9').filter((e) => /cells/.test(e.title));
  assert.equal(copies.length, 1, 'no second copy');
  assert.equal(copies[0].id, 'old-g9-2@fake');
  assert.match(copies[0].title, /^Summative: Biology 9 Boys/);
  assert.equal(g.Entries.byId(cells.id).mirror_status, 'OK');
  assert.equal(g.Mirror.syncImports().moved, 0, 'from then on the app is in charge of it');
});

test('AISA abbreviations: SA is summative, FA formative', () => {
  assert.equal(g.Mirror.guessCategory('SA_G11 Chem. Girls_215'), 'SUMMATIVE');
  assert.equal(g.Mirror.guessCategory('G12 Physics SA_D6 P5_113'), 'SUMMATIVE');
  assert.equal(g.Mirror.guessCategory('FA_G11 Chem. Boys_113'), 'FORMATIVE');
  assert.equal(g.Mirror.guessCategory('USA trip'), '');
  assert.equal(g.Mirror.guessCategory('FAQ for parents'), '');
});
