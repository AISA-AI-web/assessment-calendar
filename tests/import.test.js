'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { load, fresh } = require('./harness');

const g = load();

test('PowerSchool meeting patterns in the usual forms', () => {
  const p = (e, m) => g.Dir.parseExpression(e, m).map((x) => x.day + ':' + x.period).join(' ');
  assert.equal(p('3(1,4,7) 5(9)'), '1:3 4:3 7:3 9:5');
  assert.equal(p('3(D1,D4)'), '1:3 4:3');
  assert.equal(p('P2(1-3)'), '1:2 2:2 3:2');
  assert.equal(p('1-2(A-B)', { A: 1, B: 2 }), '1:1 1:2 2:1 2:2');
  assert.equal(p('nonsense'), '');
  assert.equal(g.Dir.describeMeetings(g.Dir.parseExpression('3(1,4,7) 5(9)')), 'P3 on Days 1, 4, 7 · P5 on Day 9');
});

test('term codes map to semesters', () => {
  fresh();
  const s = g.Config.get();
  assert.deepEqual(g.Dir.termRange('S1', s), ['2026-08-31', '2027-02-05']);
  assert.deepEqual(g.Dir.termRange('Sem 2', s), ['2027-02-08', '2027-07-02']);
  assert.deepEqual(g.Dir.termRange('26-27', s), ['2026-08-31', '2027-07-02']);
});

function table(headers, rows) { return { exists: true, headers, rows }; }

test('import accepts PowerSchool header names and reports problems', () => {
  fresh();
  const s = g.Config.get();
  const sec = table(
    ['Sections.ID', 'Course_Number', 'Course_Name', 'Section_Number', 'Teachers.Email_Addr', 'Expression', 'Abbreviation'],
    [
      ['5001', 'G09ENG', 'English 9 Girls', '1', 'A.Teacher@School.example', '3(1,4,7)', '26-27'],
      ['5002', 'K1MATH', 'Grade 1 Math', '1', 'b.teacher@school.example', '1(A)', '26-27'],
      ['5003', 'G09BIO', 'Biology 9', '2', 'not-an-email', '???', 'S1'],
      ['5001', 'G09ENG', 'dup', '1', 'x@school.example', '1(1)', 'S1']
    ]
  );
  const enr = table(
    ['Student_Number', 'Email', 'Grade_Level', 'CC.SectionID', 'CC.DateEnrolled', 'CC.DateLeft'],
    [
      ['9001', 's9001@school.example', '9', '5001', '8/31/2026', ''],
      ['9001', 's9001@school.example', '9', '5003', '8/31/2026', '2/8/2027'],
      ['9002', '', '9', '5001', '8/31/2026', ''],
      ['1001', 's1001@school.example', '1', '5002', '8/31/2026', ''],
      ['9003', 's9003@school.example', '9', '9999', '8/31/2026', ''],
      ['9004', 's9004@school.example', '9', '-5001', '8/31/2026', '']
    ]
  );
  const out = g.PsImport.build(sec, enr, s);
  const r = out.report;
  assert.deepEqual(r.errors, []);
  assert.equal(r.sections, 2);
  assert.equal(r.sectionsWithoutStudents, 1);       // the Grade 1 section
  assert.equal(r.rowsOutsideGrades, 1);
  assert.equal(r.rowsUnknownSection, 1);
  assert.equal(r.studentsWithoutEmail, 1);
  assert.equal(r.duplicateSections, 1);
  assert.equal(r.badTeacherEmails.length, 1);
  assert.equal(r.badExpressions.length, 1);
  const eng = out.sections.find((x) => x.section_id === '5001');
  assert.equal(eng.teacher_emails, 'a.teacher@school.example');
  assert.equal(eng.grades, '9');
  assert.equal(eng.student_count, 2);
  const left = out.enrolments.find((x) => x.section_id === '5003');
  assert.equal(left.date_left, '2027-02-08');
});

test('import refuses files with missing columns and changes nothing', () => {
  const t = fresh();
  t.backend.replace('PS_Sections', ['ID', 'Course_Number'], [['1', 'X']]);
  t.backend.replace('PS_Enrolments', ['Student_Number'], [['1']]);
  const before = t.backend.objects('Sections').length;
  const r = g.PsImport.process();
  assert.ok(r.errors.length >= 2);
  assert.equal(t.backend.objects('Sections').length, before);
  assert.match(g.PsImport.describe(r), /Nothing was changed/);
});

test('a processed import replaces the live tables and resets the directory', () => {
  const t = fresh();
  t.backend.replace('PS_Sections', ['section_id', 'course_number', 'course_name', 'section_number', 'teacher_email', 'expression', 'term'],
    [['7001', 'G07SCI', 'Science 7 Girls', '1', 'new.teacher@school.example', '2(1,6)', 'Year']]);
  t.backend.replace('PS_Enrolments', ['student_number', 'student_email', 'grade_level', 'section_id'],
    [['7001', 's7001@school.example', '7', '7001'], ['7002', 's7002@school.example', '7', '7001']]);
  const r = g.PsImport.process();
  assert.deepEqual(r.errors, []);
  const sections = t.backend.objects('Sections');
  assert.deepEqual(sections.filter((x) => x.status !== 'RETIRED').map((x) => x.section_id), ['7001']);
  // Old classes that have bookings stay, retired, so their entries keep their names.
  assert.equal(sections.filter((x) => x.status === 'RETIRED').length, r.retired.length);
  assert.ok(r.retired.length > 0);
  assert.equal(g.Dir.userFor('new.teacher@school.example').role, 'TEACHER');
  assert.equal(g.Dir.userFor('s7002@school.example').role, 'STUDENT');
  assert.equal(g.Dir.studentsInSection('7001', '2026-10-21').length, 2);
});

test('roles: Staff tab first, then section teachers, then students, else no access', () => {
  const t = fresh();
  assert.equal(g.Dir.userFor('TL.Head@school.example').role, 'SLT');
  assert.equal(g.Dir.userFor(t.fx.people.teacher).role, 'TEACHER');
  assert.equal(g.Dir.userFor(t.fx.people.student).role, 'STUDENT');
  assert.equal(g.Dir.userFor('counsellor@school.example').role, 'VIEWER');
  assert.equal(g.Dir.userFor('stranger@school.example').role, 'NONE');
});
