/**
 * Import.gs: turns the two PowerSchool CSV exports into the Sections and
 * Enrolments tabs (see docs/POWERSCHOOL_EXPORT.md).
 *
 * The admin imports sections.csv into the PS_Sections tab and enrolments.csv
 * into PS_Enrolments (File → Import → Replace current sheet, with "Convert text
 * to numbers, dates and formulas" unticked), then runs
 * Assessment Calendar → Process PowerSchool import. Nothing live changes until
 * both files pass the checks below.
 */
var PsImport = (function () {
  'use strict';

  var SECTION_FIELDS = {
    section_id: ['section_id', 'sectionid', 'sections.id', 'id', 'dcid'],
    course_number: ['course_number', 'coursenumber', 'course_no', 'courses.course_number', 'course'],
    course_name: ['course_name', 'coursename', 'courses.course_name', 'name'],
    section_number: ['section_number', 'sectionnumber', 'sections.section_number', 'section'],
    teacher_email: ['teacher_email', 'teacheremail', 'teachers.email_addr', 'email_addr', 'teacher'],
    teacher_name: ['teacher_name', 'teachername', 'teachers.lastfirst', 'lastfirst'],
    co_teacher_emails: ['co_teacher_emails', 'coteacheremails', 'co_teachers', 'coteachers'],
    expression: ['expression', 'sections.expression', 'periods', 'meeting_pattern'],
    term: ['term', 'terms.abbreviation', 'term_abbreviation', 'abbreviation', 'termid'],
    department: ['department', 'courses.credittype', 'credittype', 'subject']
  };

  var ENROLMENT_FIELDS = {
    student_number: ['student_number', 'studentnumber', 'students.student_number', 'student_id', 'studentid'],
    student_email: ['student_email', 'studentemail', 'students.email', 'email', 'student_web_id'],
    grade_level: ['grade_level', 'gradelevel', 'students.grade_level', 'grade'],
    section_id: ['section_id', 'sectionid', 'cc.sectionid', 'sections.id'],
    date_enrolled: ['date_enrolled', 'dateenrolled', 'cc.dateenrolled'],
    date_left: ['date_left', 'dateleft', 'cc.dateleft']
  };

  var REQUIRED_SECTION = ['section_id', 'course_number', 'course_name', 'teacher_email', 'expression', 'term'];
  var REQUIRED_ENROLMENT = ['student_number', 'student_email', 'grade_level', 'section_id'];

  function key(h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  /** field → column index, using the first alias each header matches. */
  function mapHeaders(headers, fields) {
    var keys = headers.map(key);
    var map = {};
    Object.keys(fields).forEach(function (f) {
      map[f] = -1;
      fields[f].some(function (alias) {
        var i = keys.indexOf(key(alias));
        if (i >= 0) map[f] = i;
        return i >= 0;
      });
    });
    return map;
  }

  function missing(map, required) {
    return required.filter(function (f) { return map[f] < 0; });
  }

  function val(row, i) { return i >= 0 ? row[i] : ''; }

  /** Pure core, so it can be tested without a Sheet. Returns { sections, enrolments, report }. */
  function build(secTable, enrTable, settings) {
    var s = settings;
    var report = {
      sections: 0, enrolments: 0, students: 0, sectionsWithoutStudents: 0,
      rowsOutsideGrades: 0, rowsUnknownSection: 0, studentsWithoutEmail: 0,
      duplicateSections: 0, badTeacherEmails: [], badExpressions: [], errors: []
    };

    var sm = mapHeaders(secTable.headers, SECTION_FIELDS);
    var em = mapHeaders(enrTable.headers, ENROLMENT_FIELDS);
    var ms = missing(sm, REQUIRED_SECTION);
    var me = missing(em, REQUIRED_ENROLMENT);
    if (!secTable.rows.length) report.errors.push('PS_Sections is empty.');
    if (!enrTable.rows.length) report.errors.push('PS_Enrolments is empty.');
    if (ms.length) report.errors.push('PS_Sections is missing columns: ' + ms.join(', ') + '.');
    if (me.length) report.errors.push('PS_Enrolments is missing columns: ' + me.join(', ') + '.');
    if (report.errors.length) return { sections: [], enrolments: [], report: report };

    var sections = {};
    var order = [];
    secTable.rows.forEach(function (row) {
      var id = U.clean(val(row, sm.section_id));
      if (!id || /^-/.test(id)) return;
      if (sections[id]) {
        report.duplicateSections++;
        return;
      }
      var lead = U.normEmail(val(row, sm.teacher_email));
      var co = U.splitList(val(row, sm.co_teacher_emails)).map(U.normEmail);
      var emails = U.uniq([lead].concat(co)).filter(Boolean);
      var label = U.clean(val(row, sm.course_number)) + '.' + U.clean(val(row, sm.section_number));
      emails.forEach(function (e) {
        if (e.indexOf('@') < 0 && report.badTeacherEmails.length < 10) report.badTeacherEmails.push(label + ': "' + e + '"');
      });
      var expr = U.clean(val(row, sm.expression));
      if (expr && !Dir.parseExpression(expr, s.dayLetterMap).length && report.badExpressions.length < 10) {
        report.badExpressions.push(label + ': "' + expr + '"');
      }
      sections[id] = {
        section_id: id,
        course_number: U.clean(val(row, sm.course_number)),
        course_name: U.clean(val(row, sm.course_name)),
        section_number: U.clean(val(row, sm.section_number)),
        teacher_emails: emails.filter(function (e) { return e.indexOf('@') > 0; }).join(';'),
        teacher_names: U.clean(val(row, sm.teacher_name)),
        expression: expr,
        term: U.clean(val(row, sm.term)),
        department: U.clean(val(row, sm.department)),
        grades: '',
        student_count: 0
      };
      order.push(id);
    });

    var enrolments = [];
    var seen = {};
    var students = {};
    var noEmail = {};
    var grades = {};
    var counts = {};
    enrTable.rows.forEach(function (row) {
      var sid = U.clean(val(row, em.section_id));
      var num = U.clean(val(row, em.student_number));
      if (!sid || !num || /^-/.test(sid)) return;
      var grade = U.normGrade(val(row, em.grade_level));
      if (s.grades.indexOf(grade) < 0) {
        report.rowsOutsideGrades++;
        return;
      }
      if (!sections[sid]) {
        report.rowsUnknownSection++;
        return;
      }
      var from = U.normDate(val(row, em.date_enrolled));
      var k = num + '|' + sid + '|' + from;
      if (seen[k]) return;
      seen[k] = true;
      var email = U.normEmail(val(row, em.student_email));
      if (email.indexOf('@') < 0) {
        email = '';
        noEmail[num] = true;
      }
      students[num] = true;
      (grades[sid] = grades[sid] || {})[grade] = true;
      (counts[sid] = counts[sid] || {})[num] = true;
      enrolments.push({
        student_number: num, student_email: email, grade: grade, section_id: sid,
        date_enrolled: from, date_left: U.normDate(val(row, em.date_left))
      });
    });

    var kept = [];
    order.forEach(function (id) {
      var sec = sections[id];
      if (!grades[id]) {
        report.sectionsWithoutStudents++;
        return;
      }
      sec.grades = U.sortGrades(Object.keys(grades[id])).join(',');
      sec.student_count = Object.keys(counts[id]).length;
      kept.push(sec);
    });

    report.sections = kept.length;
    report.enrolments = enrolments.length;
    report.students = Object.keys(students).length;
    report.studentsWithoutEmail = Object.keys(noEmail).length;
    if (!kept.length) report.errors.push('No section has any enrolled student in grades ' + s.grades.join(', ') + '.');
    return { sections: kept, enrolments: enrolments, report: report };
  }

  /** Reads PS_Sections and PS_Enrolments, checks them, and replaces Sections and Enrolments. */
  function process() {
    var s = Config.get();
    var out = build(Store.raw('PS_Sections'), Store.raw('PS_Enrolments'), s);
    if (out.report.errors.length) return out.report;
    Svc.withLock(function () {
      Store.replaceAll('Sections', out.sections);
      Store.replaceAll('Enrolments', out.enrolments);
      Store.append('Log', [{
        at: Svc.stamp(), user: Svc.userEmail(), action: 'POWERSCHOOL_IMPORT', ref: '',
        details: JSON.stringify(out.report).slice(0, 2000)
      }]);
    });
    Dir.reset();
    return out.report;
  }

  /** The report as a few plain lines for an alert box. */
  function describe(r) {
    if (r.errors.length) return 'Nothing was changed.\n\n' + r.errors.join('\n');
    var lines = [
      'Imported ' + r.sections + ' sections, ' + r.students + ' students and ' + r.enrolments + ' enrolments.'
    ];
    if (r.sectionsWithoutStudents) lines.push(r.sectionsWithoutStudents + ' sections had no students in these grades and were left out.');
    if (r.rowsOutsideGrades) lines.push(r.rowsOutsideGrades + ' enrolment rows were for other grades and were skipped.');
    if (r.rowsUnknownSection) lines.push(r.rowsUnknownSection + ' enrolment rows named a section that is not in PS_Sections.');
    if (r.studentsWithoutEmail) lines.push(r.studentsWithoutEmail + ' students have no email, so they cannot sign in.');
    if (r.duplicateSections) lines.push(r.duplicateSections + ' duplicate section rows were ignored.');
    if (r.badTeacherEmails.length) lines.push('Teacher emails that are not emails: ' + r.badTeacherEmails.join('; '));
    if (r.badExpressions.length) lines.push('Meeting patterns that could not be read: ' + r.badExpressions.join('; '));
    return lines.join('\n');
  }

  return {
    SECTION_FIELDS: SECTION_FIELDS, ENROLMENT_FIELDS: ENROLMENT_FIELDS,
    mapHeaders: mapHeaders, build: build, process: process, describe: describe
  };
})();
