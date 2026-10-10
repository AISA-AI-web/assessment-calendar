'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fresh } = require('./harness');

const g = load();

function sid(t, course) { return t.fx.courses[course].section_id; }

function evaluate(t, user, draft) {
  g.Entries.reset();
  const u = g.Dir.userFor(user);
  const d = g.Entries.sanitize(Object.assign({ title: 'Test', category: 'SUMMATIVE' }, draft), true);
  return JSON.parse(JSON.stringify(g.Rules.evaluate(d, u)));
}

function codes(row) { return row.issues.map((i) => i.code); }

/** First school day on or after `from` when the section meets and policy allows a summative. */
function clearMeetingDay(t, course, from) {
  const id = sid(t, course);
  const sec = g.Dir.section(id);
  for (const d of g.U.range(from, '2026-12-10')) {
    const day = g.Days.day(d);
    if (day.status !== 'SCHOOL' || !day.rotation) continue;
    const meets = g.Rules.meetingPeriods(sec, d);
    if (!meets || !meets.length) continue;
    const ev = evaluate(t, t.fx.people.slt, { rows: [{ sectionId: id, date: d, periods: meets }] });
    if (ev.verdict === 'OK') return { date: d, periods: meets };
  }
  throw new Error('no clear day for ' + course);
}

test('a third summative for the same students is blocked, with the clashes and alternatives', () => {
  const t = fresh();
  const ev = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: sid(t, 'G09BIO'), date: '2026-10-27', periods: [] }] });
  assert.equal(ev.verdict, 'BLOCK');
  assert.equal(ev.canRequest, true);
  assert.equal(ev.canOverride, false);
  const row = ev.rows[0];
  assert.ok(codes(row).includes('DAY_CAP'));
  assert.equal(row.affected.count, 18);
  assert.equal(row.affected.emails.length, 18);
  assert.deepEqual(row.clashes.map((c) => c.title).sort(), ['Persuasive essay', 'Unit 3 test: linear functions']);
  assert.ok(row.clashes.every((c) => c.students === 18));
  assert.deepEqual(row.load, { before: 2, after: 3, cap: 2, students: 18 });
  assert.ok(row.suggestions.length > 0);
  const sec = g.Dir.section(sid(t, 'G09BIO'));
  for (const s of row.suggestions) {
    assert.ok(s.date > '2026-10-27');
    assert.ok(s.periods.length > 0, 'suggests only days the class meets');
    assert.ok(g.Rules.meetingPeriods(sec, s.date).length > 0);
  }
});

test('the boys in the same grade are not affected by the girls\' load', () => {
  const t = fresh();
  const ev = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: sid(t, 'B09BIO'), date: '2026-10-27', periods: [] }] });
  assert.notEqual(ev.verdict, 'BLOCK');
  assert.equal(ev.rows[0].load.after, ev.rows[0].load.before + 1);
});

test('formatives never count toward the limit', () => {
  const t = fresh();
  const ev = evaluate(t, t.fx.people.teacher, {
    category: 'FORMATIVE', rows: [{ sectionId: sid(t, 'G09BIO'), date: '2026-10-27', periods: [] }]
  });
  assert.ok(!codes(ev.rows[0]).includes('DAY_CAP'));
  assert.notEqual(ev.verdict, 'BLOCK');
});

test('rows in one booking count against each other', () => {
  const t = fresh();
  const day = clearMeetingDay(t, 'G09ART', '2026-11-16');
  const rows = ['G09ART', 'G09SPA', 'G09HIST'].map((c) => ({ sectionId: sid(t, c), date: day.date, periods: [] }));
  const two = evaluate(t, t.fx.people.slt, { rows: rows.slice(0, 2) });
  assert.ok(two.rows.every((r) => !codes(r).includes('DAY_CAP')), JSON.stringify(two.rows.map(codes)));
  const three = evaluate(t, t.fx.people.slt, { rows });
  assert.equal(three.verdict, 'BLOCK');
  assert.ok(three.rows.every((r) => codes(r).includes('DAY_CAP')));
  assert.ok(three.rows[0].clashes.some((c) => c.title === 'Another class in this booking'));
  assert.equal(three.canOverride, true);
});

test('no-assessment days, exam windows, closures, weekends and missing periods', () => {
  const t = fresh();
  const T = t.fx.people.teacher;
  const g10 = sid(t, 'G10BIO');
  let ev = evaluate(t, T, { rows: [{ sectionId: g10, date: '2026-11-26', periods: [] }] });
  assert.equal(ev.verdict, 'BLOCK');
  assert.ok(codes(ev.rows[0]).includes('NO_ASSESSMENT_DAY'));

  ev = evaluate(t, T, { rows: [{ sectionId: g10, date: '2026-10-14', periods: [] }] });
  assert.equal(ev.verdict, 'INVALID');
  assert.deepEqual(codes(ev.rows[0]), ['CLOSED']);

  ev = evaluate(t, T, { rows: [{ sectionId: g10, date: '2026-10-24', periods: [] }] });
  assert.deepEqual(codes(ev.rows[0]), ['WEEKEND']);

  ev = evaluate(t, T, { rows: [{ sectionId: g10, date: '2026-10-23', periods: ['6'] }] });
  assert.ok(codes(ev.rows[0]).includes('NO_SUCH_PERIOD'));

  ev = evaluate(t, t.fx.people.slt, { rows: [{ sectionId: sid(t, '11BIOHL'), date: '2027-01-27', periods: [] }] });
  assert.ok(codes(ev.rows[0]).includes('EXAM_WINDOW'));
  ev = evaluate(t, t.fx.people.slt, { category: 'EXAM', rows: [{ sectionId: sid(t, '11BIOHL'), date: '2027-01-27', periods: [] }] });
  assert.ok(!codes(ev.rows[0]).includes('EXAM_WINDOW'));
  // The Grade 9 boys are not in the IB mock window.
  ev = evaluate(t, T, { rows: [{ sectionId: sid(t, 'B09BIO'), date: '2027-01-27', periods: [] }] });
  assert.ok(!codes(ev.rows[0]).includes('EXAM_WINDOW'));
});

test('timed events warn only when the booking overlaps their periods', () => {
  const t = fresh();
  const g10 = sid(t, 'G10BIO');
  const during = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: g10, date: '2026-11-12', periods: ['5'] }] });
  assert.ok(during.rows[0].issues.some((i) => i.code === 'CAUTION' && /University Fair/.test(i.title)));
  const before = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: g10, date: '2026-11-12', periods: ['1'] }] });
  assert.ok(!before.rows[0].issues.some((i) => /University Fair/.test(i.title)));
  // Grade 9 is not in the University Fair.
  const g9 = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: sid(t, 'G09BIO'), date: '2026-11-12', periods: ['5'] }] });
  assert.ok(!g9.rows[0].issues.some((i) => /University Fair/.test(i.title)));
});

test('teachers book only their own classes, and never exams or whole grades', () => {
  const t = fresh();
  const T = t.fx.people.teacher;
  let ev = evaluate(t, T, { rows: [{ sectionId: sid(t, 'G09ENG'), date: '2026-11-17', periods: [] }] });
  assert.ok(codes(ev.rows[0]).includes('NOT_YOUR_CLASS'));
  ev = evaluate(t, T, { category: 'EXAM', rows: [{ sectionId: sid(t, 'G09BIO'), date: '2026-11-17', periods: [] }] });
  assert.ok(codes(ev.rows[0]).includes('EXAM_SLT_ONLY'));
  ev = evaluate(t, T, { rows: [{ grade: '9', date: '2026-11-17', periods: [] }] });
  assert.ok(codes(ev.rows[0]).includes('GRADE_SLT_ONLY'));
});

test('warns when the class does not meet that rotation day or period', () => {
  const t = fresh();
  const id = sid(t, 'G09BIO');
  const sec = g.Dir.section(id);
  const meetDays = new Set(sec.meetings.map((m) => m.day));
  const notMeeting = g.U.range('2026-11-16', '2026-11-30').find((d) => {
    const day = g.Days.day(d);
    return day.status === 'SCHOOL' && day.rotation && !meetDays.has(day.rotation);
  });
  const ev = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: id, date: notMeeting, periods: [] }] });
  assert.ok(codes(ev.rows[0]).includes('CLASS_NOT_MEETING'));
});

test('load per scope is the busiest student\'s count', () => {
  const t = fresh();
  const entries = g.Entries.all();
  const grade9 = g.Rules.loadFor({ kind: 'grade', grade: '9' }, '2026-10-26', '2026-10-30', entries);
  assert.equal(grade9.cap, 2);
  assert.equal(grade9.days['2026-10-27'].max, 2);
  assert.equal(grade9.days['2026-10-27'].at, 18);
  const boys = g.Rules.loadFor({ kind: 'section', sectionId: sid(t, 'B09BIO') }, '2026-10-27', '2026-10-27', entries);
  assert.equal(boys.days['2026-10-27'], undefined);
  const pendingNotCounted = g.Rules.loadFor({ kind: 'section', sectionId: sid(t, 'B10HIST') }, '2026-10-29', '2026-10-29', entries);
  assert.equal(pendingNotCounted.days['2026-10-29'].max, 2);
});

test('WARN mode lets anyone save past the limit with a reason', () => {
  const t = fresh({ tables: { Settings: [{ key: 'enforcement', value: 'WARN' }, { key: 'internal_calendar_id', value: 'internal@fake' }] } });
  const ev = evaluate(t, t.fx.people.teacher, { rows: [{ sectionId: sid(t, 'G09BIO'), date: '2026-10-27', periods: [] }] });
  assert.equal(ev.verdict, 'WARN');
  assert.equal(ev.needsReason, true);
});

test('student emails go only to SLT and the class\'s own teachers', () => {
  const t = fresh();
  const row = { sectionId: sid(t, 'G09BIO'), date: '2026-10-27', periods: [] };
  const own = evaluate(t, t.fx.people.teacher, { rows: [row] });
  assert.equal(own.rows[0].affected.emails.length, 18);
  const slt = evaluate(t, t.fx.people.slt, { rows: [row] });
  assert.equal(slt.rows[0].affected.emails.length, 18);
  const other = evaluate(t, t.fx.people.historyTeacher, { rows: [row] });
  assert.equal(other.rows[0].affected.count, 18);
  assert.deepEqual(other.rows[0].affected.emails, []);
});
