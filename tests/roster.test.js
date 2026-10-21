'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fresh, call } = require('./harness');

const g = load();

// Same columns as the school's roster export, with invented people. The last
// header is garbled exactly as it arrived, and its cells hold spreadsheet errors.
const HEADERS = ['Instructor ID', 'Instructor Last Name', 'Instructor First Name', 'User Name', 'Email Address',
  'Class Name', 'Student ID', 'Student Last Name', 'Student First Name', 'Student Gender', 'Student Grade',
  'Course Number', 'St7udentEmail'];

function row(o) {
  return [o.iid || '1', o.tlast || 'One', o.tfirst || 'Teacher', o.user || 't.one@school.example',
    o.email === undefined ? 't.one@school.example' : o.email, o.cls, o.sid, 'Student', 'Test', 'M', o.grade,
    o.course, o.semail || '#NAME?'];
}

const ROWS = [
  row({ cls: 'IB1ENGSL1', sid: '1001', grade: '11', course: 'IB1ENGS' }),
  row({ cls: 'IB1ENGSL1', sid: '1002', grade: '11', course: 'IB1ENGS' }),
  row({ iid: '2', tlast: 'Two', tfirst: 'Teacher', user: 't.two@school.example', email: 'T.Two@School.example',
    cls: 'IB1ENGSL1', sid: '1001', grade: '11', course: 'IB1ENGS' }),
  row({ iid: '3', tlast: 'Three', user: 't.three@school.example', email: 't.three@school.example',
    cls: 'IB1BHR1', sid: '1001', grade: '11', course: 'HHR' }),
  row({ iid: '4', tlast: 'Four', user: 't.four@school.example', email: 't.four@school.example',
    cls: 'B07ASA1', sid: '2001', grade: '7', course: 'B07ASA', semail: 's2001@school.example' }),
  row({ iid: '5', tlast: 'Five', user: 'T.Five@School.example', email: '',
    cls: 'G09MATH1', sid: '3001', grade: '9', course: 'G09MATH' }),
  row({ cls: 'G03ART1', sid: '4001', grade: '3', course: 'G03ART' }),
  row({ cls: 'IB1ENGSL1', sid: '', grade: '11', course: 'IB1ENGS' })
];

function settings(extra) {
  fresh();
  return Object.assign({}, g.Config.get(), extra || {});
}

test('the school roster becomes classes and enrolments, without names', () => {
  const out = g.PsImport.buildRoster({ headers: HEADERS, rows: ROWS }, settings());
  const r = out.report;
  assert.deepEqual(r.errors, []);
  assert.deepEqual(out.sections.map((s) => s.section_id), ['IB1ENGSL1', 'B07ASA1', 'G09MATH1']);
  const eng = out.sections[0];
  assert.equal(eng.course_number, 'IB1ENGS');
  assert.equal(eng.teacher_emails, 't.one@school.example;t.two@school.example');
  assert.equal(eng.teacher_names, 'Teacher One;Teacher Two');
  assert.equal(eng.grades, '11');
  assert.equal(eng.student_count, 2);
  assert.equal(out.sections[2].teacher_emails, 't.five@school.example', 'falls back to User Name, lower-cased');
  assert.equal(out.enrolments.length, 4);
  assert.equal(r.duplicateRows, 1, 'the co-teacher row is merged');
  assert.equal(r.coTaught, 1);
  assert.deepEqual(r.skippedCourses, { HHR: 1 });
  assert.equal(r.rowsOutsideGrades, 1);
  assert.equal(r.rowsMissingStudent, 1);
  assert.equal(r.teachers, 4);
  assert.equal(r.students, 4);
  assert.equal(r.studentsWithoutEmail, 3, '#NAME? is not an email');
  for (const en of out.enrolments) {
    assert.deepEqual(Object.keys(en).sort(), ['date_enrolled', 'date_left', 'grade', 'section_id', 'student_email', 'student_number']);
  }
  assert.equal(out.enrolments.find((e) => e.student_number === '2001').student_email, 's2001@school.example');
});

test('a student email pattern fills in missing emails', () => {
  const out = g.PsImport.buildRoster({ headers: HEADERS, rows: ROWS }, settings({ studentEmailPattern: '{id}@school.example' }));
  assert.equal(out.report.emailsFromPattern, 3);
  assert.equal(out.report.studentsWithoutEmail, 0);
  assert.equal(out.enrolments.find((e) => e.student_number === '1001').student_email, '1001@school.example');
  assert.equal(out.enrolments.find((e) => e.student_number === '2001').student_email, 's2001@school.example', 'a real email wins');
  assert.equal(g.PsImport.emailFromPattern('{first}.{last}@school.example', '7', 'Zoë', "O'Neil-Ray"), 'zoe.oneilray@school.example');
});

test('a roster without the essential columns is refused', () => {
  const out = g.PsImport.buildRoster({ headers: ['Name', 'Grade'], rows: [['x', '9']] }, settings());
  assert.ok(out.report.errors.length >= 2);
  assert.match(g.PsImport.describe(out.report), /Nothing was changed/);
});

test('checking the roster changes nothing; loading replaces classes and lists new course codes', () => {
  const t = fresh();
  t.backend.replace('Roster', HEADERS, ROWS);
  const before = t.backend.objects('Sections').length;
  const check = g.PsImport.process({ dryRun: true });
  assert.equal(check.dryRun, true);
  assert.equal(check.source, 'Roster tab');
  assert.equal(t.backend.objects('Sections').length, before);
  assert.match(g.PsImport.describe(check), /^Loading would bring in 3 classes, 4 students and 4 enrolments/);

  const r = g.PsImport.process();
  assert.deepEqual(r.errors, []);
  const live = t.backend.objects('Sections').filter((s) => s.status !== 'RETIRED').map((s) => s.section_id);
  assert.deepEqual(live, ['IB1ENGSL1', 'B07ASA1', 'G09MATH1']);
  assert.deepEqual(t.backend.objects('CourseNames').map((c) => c.course_number), ['B07ASA', 'G09MATH', 'IB1ENGS']);
  assert.equal(g.Dir.userFor('t.two@school.example').role, 'TEACHER');
  assert.equal(g.Dir.label(g.Dir.section('IB1ENGSL1')), 'IB1ENGSL1');

  // A friendly name typed into CourseNames shows up straight away.
  const names = t.backend.db.CourseNames;
  names.rows[names.rows.findIndex((r) => r[0] === 'IB1ENGS')][names.headers.indexOf('course_name')] = 'English A SL';
  g.Store.invalidate();
  g.Dir.reset();
  assert.equal(g.Dir.label(g.Dir.section('IB1ENGSL1')), 'English A SL (IB1ENGSL1)');
  assert.match(g.PsImport.describe(r), /added to the CourseNames tab/);
});

test('classes that have bookings but leave the roster are kept as retired', () => {
  const t = fresh();
  const booked = t.fx.courses.G09ENG.section_id;
  t.backend.replace('Roster', HEADERS, ROWS);
  const r = g.PsImport.process();
  assert.ok(r.retired.some((x) => x.indexOf(booked) === 0), 'the old Grade 9 English class is kept');
  const kept = t.backend.objects('Sections').find((s) => s.section_id === booked);
  assert.equal(kept.status, 'RETIRED');
  assert.equal(kept.student_count, '0');
  g.Dir.reset();
  assert.equal(g.Dir.label(g.Dir.section(booked)), 'English 9 Girls (G09ENG.1)', 'old entries keep their class name');
  assert.equal(g.Dir.studentsInSection(booked, '2026-10-27').length, 0, 'and no longer count toward load');

  t.as(t.fx.people.slt);
  const boot = call(g, 'apiBootstrap');
  assert.ok(!boot.data.sections.some((s) => s.id === booked), 'retired classes are not offered for new bookings');
  assert.ok(boot.data.sections.some((s) => s.id === 'IB1ENGSL1'));
  const range = call(g, 'apiGetRange', { start: '2026-10-26', end: '2026-10-30', scope: 'all' });
  assert.ok(range.data.entries.some((e) => e.label === 'English 9 Girls (G09ENG.1)'));
});

test('teachers of roster classes book for them, and the per-student limit uses the roster', () => {
  const t = fresh();
  const rows = [];
  // Two classes that share the same three Grade 11 students.
  ['1101', '1102', '1103'].forEach((sid) => {
    rows.push(row({ cls: 'IB1ENGSL1', sid, grade: '11', course: 'IB1ENGS' }));
    rows.push(row({ iid: '6', tlast: 'Six', user: 't.six@school.example', email: 't.six@school.example', cls: 'IB1PHYHL', sid, grade: '11', course: 'IB1PHYH' }));
    rows.push(row({ iid: '7', tlast: 'Seven', user: 't.seven@school.example', email: 't.seven@school.example', cls: 'IB1ECOHL', sid, grade: '11', course: 'IB1ECOH' }));
  });
  t.backend.replace('Roster', HEADERS, rows);
  g.PsImport.process();
  const make = (who, cls) => {
    t.as(who);
    return call(g, 'apiCreate', { title: cls + ' test', category: 'SUMMATIVE', rows: [{ sectionId: cls, date: '2026-11-17', periods: [] }] });
  };
  assert.equal(make('t.one@school.example', 'IB1ENGSL1').data.status, 'ACTIVE');
  assert.equal(make('t.six@school.example', 'IB1PHYHL').data.status, 'ACTIVE');
  const third = make('t.seven@school.example', 'IB1ECOHL');
  assert.equal(third.ok, false);
  assert.equal(third.error.code, 'BLOCKED');
  assert.equal(third.error.details.evaluation.rows[0].affected.count, 3);
});
