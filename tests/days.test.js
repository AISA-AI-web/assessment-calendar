'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fresh } = require('./harness');

const g = load();

function classify(title, extra) {
  const ev = Object.assign({ title, description: '', allDay: true, startTime: '' }, extra || {});
  return g.Days.classify(ev, g.Days.DEFAULT_RULES.map((r) => ({ re: new RegExp(r[0], 'i'), category: r[1] })));
}

test('dates are plain strings and survive month ends', () => {
  assert.equal(g.U.addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(g.U.isoDow('2026-10-23'), 5);
  assert.equal(g.U.weekStart('2026-10-25'), '2026-10-19');
  assert.equal(g.U.monthEnd('2027-02-10'), '2027-02-28');
  assert.equal(g.U.normDate('9/1/2026'), '2026-09-01');
  assert.equal(g.U.normDate('2026-02-30'), '');
  assert.equal(g.U.normTime('1:10', true), '13:10');
  assert.equal(g.U.normTime('7:55', true), '07:55');
  assert.equal(g.U.normGrade('Grade 09'), '9');
  assert.equal(g.U.human('2026-10-27'), 'Tue 27 Oct');
});

test('real Internal Calendar titles are classified as expected', () => {
  const cases = [
    ['MS/ HS Day 4', 'ROTATION'],
    ['Elem. Day E', 'HIDDEN'],
    ['Mid Term Break', 'CLOSED'],
    ['Professional Development Day - NO STUDENTS\t \t', 'CLOSED'],
    ['Eid Al Etihad - TBD', 'CLOSED'],
    ['MS & HS National Day Celebration Time TBD', 'NO_ASSESSMENTS'],
    ['High School Sports Day', 'NO_ASSESSMENTS'],
    ['End-of-Year Semester Exams', 'EXAM_WINDOW'],
    ['WINTER MAP TESTING WEEK', 'TESTING'],
    [' MAP Make-Up and Retesting Schedule', 'TESTING'],
    ['SAT testing on Campus', 'TESTING'],
    ['IB Entrance Exams', 'EVENT'],
    ['Parent-Teacher Conferences \t \t', 'CAUTION'],
    ['Secondary Career Fair  G6-G9 ', 'CAUTION'],
    ['Term 1 Grades DUE', 'DEADLINE'],
    ['End of Trimester 1 & Sem 1 Progress Reports', 'DEADLINE'],
    ['WINTER ASA Registration Begins\t', 'HIDDEN'],
    ['TRIMESTER 1 ', 'HIDDEN'],
    ['SEMESTER 2', 'HIDDEN'],
    ['School Photography Week', 'EVENT']
  ];
  for (const [title, cat] of cases) assert.equal(classify(title).category, cat, title);
  assert.equal(classify('Grade 9 parent virtual information session', { allDay: false, startTime: '17:30' }).category, 'HIDDEN');
});

test('grades are read from titles and descriptions', () => {
  const p = (t) => g.Days.parseGrades(t);
  assert.deepEqual(p('Secondary Career Fair  G6-G9 '), ['6', '7', '8', '9']);
  assert.deepEqual(p('High School Sports Day'), ['9', '10', '11', '12']);
  assert.deepEqual(p('MS October Assembly'), ['6', '7', '8']);
  assert.deepEqual(p('MS & HS National Day Celebration'), ['6', '7', '8', '9', '10', '11', '12']);
  assert.deepEqual(p('G3 CAT4 Assessment'), ['3']);
  assert.deepEqual(p('Senior Breakfast'), ['12']);
  assert.deepEqual(p('Grade 5-6 Transition-Time TBD'), ['5', '6']);
  assert.equal(p('G09ART - Visual Arts Summative Unit 1'), null);
  assert.equal(p('World Teacher Day'), null);
  assert.deepEqual(classify('University Fair', { description: 'University Fair (P5–6) G10-G12 Big Gym' }).grades, ['10', '11', '12']);
});

test('rotation days come from the calendar, including the skipped numbers', () => {
  fresh();
  const day = (d) => g.Days.day(d);
  assert.equal(day('2026-10-09').rotation, 10);
  assert.equal(day('2026-10-21').rotation, 3);        // Day 10 is followed by Day 3 after the break
  assert.equal(day('2026-12-04').rotation, 5);        // Dec 2–3 consumed Days 3 and 4
  assert.equal(day('2026-10-14').status, 'CLOSED');
  assert.equal(day('2026-10-19').status, 'CLOSED');
  assert.equal(day('2026-10-24').status, 'WEEKEND');
  assert.equal(day('2027-08-02').status, 'OUTSIDE');
  assert.equal(day('2027-04-12').rotation, null);      // not published yet: a normal school day
  assert.equal(day('2027-04-12').status, 'SCHOOL');
});

test('a closure on a day that still has a rotation day becomes "no assessments"', () => {
  fresh();
  const d = g.Days.day('2026-11-26');
  assert.equal(d.status, 'SCHOOL');
  const cats = g.Days.eventsFor('2026-11-26', ['9']).map((e) => e.category);
  assert.deepEqual(cats, ['NO_ASSESSMENTS', 'NO_ASSESSMENTS']);
});

test('a weekday with no rotation day inside the published range is UNLISTED', () => {
  const t = fresh({ sync: false });
  // Remove Day 1 on 2026-11-02 from the fake calendar, as if a holiday were missing.
  const cal = t.svc.state.calendars['internal@fake'];
  for (const id of Object.keys(cal.events)) {
    if (cal.events[id].startDate === '2026-11-02' && /Day 1$/.test(cal.events[id].title)) delete cal.events[id];
  }
  g.Days.sync();
  g.Days.reset();
  assert.equal(g.Days.day('2026-11-02').status, 'UNLISTED');
});

test('sync keeps admin overrides and hides events for other divisions', () => {
  const t = fresh();
  const rows = t.backend.objects('InternalEvents');
  const ix = rows.findIndex((r) => r.title === 'School Photography Week');
  t.backend.db.InternalEvents.rows[ix][t.backend.db.InternalEvents.headers.indexOf('override_category')] = 'HIDDEN';
  g.Store.invalidate();
  g.Days.sync();
  g.Store.invalidate();
  g.Days.reset();
  const again = t.backend.objects('InternalEvents').find((r) => r.title === 'School Photography Week');
  assert.equal(again.override_category, 'HIDDEN');
  assert.equal(g.Days.eventsFor('2026-10-27', null).some((e) => e.title === 'School Photography Week'), false);
  assert.equal(g.Days.eventsFor('2026-10-26', null).some((e) => /CAT4/.test(e.title)), false);
});

test('bell times: Monday–Thursday has 7 periods, Friday has 4', () => {
  fresh();
  assert.deepEqual(g.Days.periodsFor('2026-10-22').map((p) => p.p), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(g.Days.periodsFor('2026-10-23').map((p) => p.p), ['1', '2', '3', '4']);
  assert.equal(g.Days.periodsFor('2026-10-23')[0].start, '07:40');
  assert.equal(g.Days.periodsFor('2026-10-22')[5].start, '13:10');
  const assembly = g.Days.eventsFor('2026-10-28', ['7']).find((e) => /Assembly/.test(e.title));
  assert.deepEqual(assembly.periods, ['2']);
});

test('a date-ranged bell schedule (e.g. Ramadan) wins over the regular one', () => {
  const t = fresh({
    tables: {
      Bells: g.Config.DEFAULT_BELLS.map((b) => ({ schedule: b[0], from: b[1], to: b[2], weekdays: b[3], period: b[4], start: b[5], end: b[6] }))
        .concat([{ schedule: 'Ramadan', from: '2027-02-08', to: '2027-03-07', weekdays: 'MON-FRI', period: '1', start: '8:30', end: '9:10' }])
    }
  });
  assert.ok(t);
  assert.deepEqual(g.Days.periodsFor('2027-02-10').map((p) => p.start), ['08:30']);
  assert.equal(g.Days.periodsFor('2027-03-10').length, 7);
});
