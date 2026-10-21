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

// PowerSchool's CC export as IT sends it: table-numbered headers, a student
// name column, dates as M/D/YYYY, no grade column. Invented people.
const CC_HEADERS = ['[1]student_number', 'StudentEmail', '[1]lastfirst', '[5]TeacherNumber', '[5]LastFirst',
  '[5]Email_Addr', '[2]Course_Name', 'Course_Number', 'TermID', 'Section_Number', 'DateLeft', 'SectionID',
  'Expression', 'DateEnrolled'];

function cc(o) {
  return [o.sid, o.sid + '@school.example', 'Pupil, Invented ' + o.sid, '9' + o.sec, o.tname || 'Doe, Jane A.',
    o.temail || 'jane.doe@school.example', o.name, o.course, o.term || '3600', o.num, o.left || '7/10/2027', o.sec,
    o.expr || '2(A,C) 3(F)', o.from || '8/21/2026'];
}

const CC_ROWS = [
  cc({ sid: '5001', sec: '9101', course: 'G09ENG', num: 'G09ENG1', name: 'English 9' }),
  cc({ sid: '5001', sec: '9102', course: 'BAPSTA', num: 'BAPSTA', name: 'AP Statistics', tname: 'Roe, Sam', temail: 's.roe@school.example' }),
  cc({ sid: '5001', sec: '9103', course: 'HHR', num: 'G09BHR1', name: 'HR / Moral Education' }),
  cc({ sid: '5002', sec: '9104', course: '11ISE', num: '11ISE', name: 'Islamic Studies in English 11' }),
  cc({ sid: '5002', sec: '9105', course: 'IB1ENGS', num: 'IB1ENGSL1', name: 'English A SL', term: '3601', left: '2/7/2027' }),
  cc({ sid: '5003', sec: '9102', course: 'BAPSTA', num: 'BAPSTA', name: 'AP Statistics', tname: 'Roe, Sam', temail: 's.roe@school.example' }),
  cc({ sid: '5004', sec: '9106', course: 'G03ART', num: 'G03ART1', name: 'Art 3' }),
  cc({ sid: '5005', sec: '9107', course: 'G10MAT', num: 'G10MAT1', name: 'Math 10' }),
  cc({ sid: '5005', sec: '9108', course: 'G10SCI', num: 'G10SCI1', name: 'Science 10', from: '9/9/2026' }),
  cc({ sid: '5005', sec: '9109', course: 'G11MAT', num: 'G11MAT1', name: 'Math 11' })
];

test("PowerSchool's CC export loads as it comes: grades from course numbers, no student names", () => {
  const out = g.PsImport.buildRoster({ headers: CC_HEADERS, rows: CC_ROWS }, settings());
  const r = out.report;
  assert.deepEqual(r.errors, []);
  assert.equal(r.gradesFromCourses, true);
  assert.equal(r.gradesMixed, 1, '5005 has Grade 10 and Grade 11 courses');
  assert.equal(r.rowsNoGrade, 1, '5003 takes only AP Statistics, which carries no grade');
  assert.equal(r.rowsOutsideGrades, 1);
  assert.deepEqual(r.skippedCourses, { HHR: 1 });
  assert.deepEqual(out.sections.map((s) => s.section_id), ['9101', '9102', '9104', '9105', '9107', '9108', '9109']);
  const eng = out.sections[0];
  assert.equal(eng.section_number, 'G09ENG1');
  assert.equal(eng.teacher_emails, 'jane.doe@school.example');
  assert.equal(eng.teacher_names, 'Jane A. Doe', "the teacher's name, turned round; not the student's");
  assert.equal(eng.term, '3600');
  assert.equal(eng.grades, '9');
  assert.equal(out.sections[1].grades, '9', 'AP Statistics takes its grade from its students');
  assert.equal(out.sections.find((s) => s.section_id === '9105').grades, '11', 'IB1 is not read as Grade 1');
  assert.ok(out.enrolments.every((e) => e.grade === { 5001: '9', 5002: '11', 5005: '10' }[e.student_number]));
  const en = out.enrolments.find((e) => e.section_id === '9101');
  assert.equal(en.date_enrolled, '2026-08-21');
  assert.equal(en.date_left, '2027-07-10');
  assert.equal(en.student_email, '5001@school.example');
  assert.doesNotMatch(JSON.stringify(out), /Pupil|Invented/, 'student names are never kept');
});

test('a CC export class shows its section code, meets on lettered days and ends with its term', () => {
  const t = fresh();
  t.backend.replace('Roster', CC_HEADERS, CC_ROWS);
  const r = g.PsImport.process();
  assert.deepEqual(r.errors, []);
  assert.match(g.PsImport.describe(r), /grade comes from their course numbers/);
  assert.equal(g.Dir.label(g.Dir.section('9101')), 'English 9 (G09ENG1)');
  assert.deepEqual(g.Dir.section('9101').meetings, [{ day: 1, period: '2' }, { day: 3, period: '2' }, { day: 6, period: '3' }]);
  const s1 = g.Dir.section('9105');
  assert.equal(s1.termEnd, '2027-02-06', 'DateLeft 2/7/2027 is the first day out');
  assert.equal(g.Dir.section('9108').termStart, '2026-09-09', 'nobody was in Science 10 before 9 September');
  assert.equal(g.Dir.section('9101').termEnd, g.Config.get().yearEnd, 'DateLeft after the year end does not stretch it');
  assert.equal(g.Dir.userFor('jane.doe@school.example').role, 'TEACHER');
  const pupil = g.Dir.userFor('5002@school.example');
  assert.equal(pupil.role, 'STUDENT');
  assert.equal(pupil.grade, '11');
});
