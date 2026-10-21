/**
 * Import.gs: who is in which class. Builds the Sections and Enrolments tabs
 * from one of two sources (see docs/SETUP.md, step 5):
 *
 *   1. The school roster: one sheet, one row per student per class per
 *      teacher, pasted or imported into the Roster tab. Columns are matched by
 *      name: Class Name, Course Number, Email Address or User Name (teacher),
 *      Instructor First/Last Name, Student ID, Student Grade, Student Email.
 *      PowerSchool's CC export works as it comes ([1]student_number,
 *      StudentEmail, [5]Email_Addr, [5]LastFirst, SectionID, Section_Number,
 *      Expression, TermID, DateEnrolled, DateLeft). Without a grade column,
 *      each student's grade is read from their course numbers.
 *   2. Two PowerSchool exports in the PS_Sections and PS_Enrolments tabs
 *      (docs/POWERSCHOOL_EXPORT.md).
 *
 * If the Roster tab has rows it is used; otherwise the two PS_ tabs are.
 * Student names and genders are never read or stored. Nothing live changes
 * until the data passes the checks below, and a dry run reports what loading
 * would do without changing anything.
 */
var PsImport = (function () {
  'use strict';

  /* ------------------------------------------------------------------
     Header matching
     ------------------------------------------------------------------ */

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

  /** Roster headers are matched by rosterKey(), so "St7udentEmail" still finds Student Email. */
  var ROSTER_FIELDS = {
    class_name: ['classname', 'class', 'sectionname', 'sectionid', 'section'],
    section_number: ['sectionnumber', 'sectionno'],
    course_number: ['coursenumber', 'coursecode', 'course'],
    course_name: ['coursename', 'coursetitle'],
    teacher_email: ['emailaddress', 'instructoremail', 'teacheremail', 'teacheremailaddr', 'instructoremailaddress',
      'email', 'emailaddr'],
    teacher_username: ['username', 'instructorusername'],
    teacher_name: ['teachername', 'teacherlastfirst', 'instructorname'],
    teacher_first: ['instructorfirstname', 'teacherfirstname'],
    teacher_last: ['instructorlastname', 'teacherlastname'],
    student_number: ['studentid', 'studentnumber'],
    student_email: ['studentemail', 'studentemailaddress'],
    student_first: ['studentfirstname'],
    student_last: ['studentlastname'],
    grade_level: ['studentgrade', 'gradelevel', 'grade', 'studentgradelevel'],
    expression: ['expression', 'periods', 'meetingpattern'],
    term: ['term', 'termabbreviation', 'termid'],
    department: ['department', 'subject'],
    date_enrolled: ['dateenrolled'],
    date_left: ['dateleft']
  };

  /** PowerSchool export headers name a field's table: "[5]LastFirst" is a teacher's name, "[1]lastfirst" a student's. */
  var PS_TABLES = { 1: 'student', 5: 'teacher' };

  var REQUIRED_SECTION = ['section_id', 'course_number', 'course_name', 'teacher_email'];
  var REQUIRED_ENROLMENT = ['student_number', 'student_email', 'grade_level', 'section_id'];

  function key(h) { return String(h).toLowerCase().replace(/[^a-z0-9]/g, ''); }

  function letters(h) { return String(h).toLowerCase().replace(/[^a-z]/g, ''); }

  /** A roster header's letters, with the table of a "[5]…" PowerSchool header in front ("teacherlastfirst"). */
  function rosterKey(h) {
    var m = String(h).match(/^\s*\[(\d+)\]\s*(.*)$/);
    var k = letters(m ? m[2] : h);
    var table = m ? PS_TABLES[m[1]] : '';
    return table && k.indexOf(table) !== 0 ? table + k : k;
  }

  /** field → column index, using the first alias each header matches. */
  function mapHeaders(headers, fields, keyFn) {
    keyFn = keyFn || key;
    var keys = headers.map(keyFn);
    var map = {};
    Object.keys(fields).forEach(function (f) {
      map[f] = -1;
      fields[f].some(function (alias) {
        var i = keys.indexOf(keyFn(alias));
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

  /** A usable email, or ''. Spreadsheet errors such as "#NAME?" are not emails. */
  function goodEmail(v) {
    var e = U.normEmail(v);
    return /^[^@\s#]+@[^@\s]+\.[^@\s]+$/.test(e) ? e : '';
  }

  function slug(v) {
    var s = String(v === null || v === undefined ? '' : v);
    if (s.normalize) s = s.normalize('NFD');
    return s.toLowerCase().replace(/[^a-z0-9]/g, '');
  }

  /** Builds an email from Settings → student_email_pattern, e.g. '{id}@aisa.sch.ae'. */
  function emailFromPattern(pattern, id, first, last) {
    if (!pattern) return '';
    return goodEmail(pattern.replace(/\{id\}/gi, slug(id)).replace(/\{first\}/gi, slug(first)).replace(/\{last\}/gi, slug(last)));
  }

  function bump(map, k) { map[k] = (map[k] || 0) + 1; }

  /** Two-digit grades in a course number: 'G07ISA' → ['7'], '11ISE' → ['11']. 'IB1ENGS' and 'BAPBIO' have none. */
  function gradesInCourse(course) {
    var out = [];
    var re = /(^|\D)(\d{2})(?!\d)/g;
    var m;
    while ((m = re.exec(course))) {
      var n = +m[2];
      if (n >= 1 && n <= 12) out.push(String(n));
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Source 1: the school roster (one sheet)
     ------------------------------------------------------------------ */

  /**
   * For a roster without a grade column: each student's grade is the one most
   * of their course numbers carry. Returns { grades: student number → grade, mixed }.
   */
  function gradesFromCourses(rows, m) {
    var votes = {};
    rows.forEach(function (row) {
      var num = U.clean(val(row, m.student_number));
      if (!num) return;
      gradesInCourse(U.clean(val(row, m.course_number)).toUpperCase()).forEach(function (g) {
        var v = votes[num] = votes[num] || {};
        v[g] = (v[g] || 0) + 1;
      });
    });
    var grades = {};
    var mixed = 0;
    Object.keys(votes).forEach(function (num) {
      var v = votes[num];
      var keys = Object.keys(v);
      if (keys.length > 1) mixed++;
      grades[num] = keys.reduce(function (best, g) { return v[g] > v[best] ? g : best; }, keys[0]);
    });
    return { grades: grades, mixed: mixed };
  }

  /** 'First Last' from the first/last name columns, or from one name column with 'Last, First' turned round. */
  function rosterTeacherName(row, m) {
    var full = U.clean([val(row, m.teacher_first), val(row, m.teacher_last)].join(' '));
    if (full) return full;
    var parts = U.clean(val(row, m.teacher_name)).split(',');
    return U.clean(parts.length === 2 ? parts[1] + ' ' + parts[0] : parts.join(','));
  }

  /**
   * Pure core of the roster import, so it can be tested without a Sheet.
   * table: { headers, rows }. Returns { sections, enrolments, report }.
   */
  function buildRoster(table, settings) {
    var s = settings;
    var report = {
      source: 'Roster tab', rowsRead: table.rows.length, rowsKept: 0, rowsOutsideGrades: 0,
      rowsSkippedCourses: 0, skippedCourses: {}, rowsMissingClass: 0, rowsMissingStudent: 0,
      duplicateRows: 0, sections: 0, students: 0, enrolments: 0, teachers: 0, coTaught: 0,
      classesWithoutTeacher: [], studentsWithoutEmail: 0, emailsFromPattern: 0, gradeConflicts: 0,
      gradesFromCourses: false, gradesMixed: 0, rowsNoGrade: 0, errors: []
    };
    var m = mapHeaders(table.headers, ROSTER_FIELDS, rosterKey);
    if (!table.rows.length) report.errors.push('The Roster tab is empty.');
    if (m.class_name < 0 && m.course_number < 0) report.errors.push('The roster needs a Class Name or Course Number column.');
    if (m.teacher_email < 0 && m.teacher_username < 0) report.errors.push('The roster needs a teacher Email Address or User Name column.');
    if (m.student_number < 0) report.errors.push('The roster needs a Student ID column.');
    if (m.grade_level < 0 && m.course_number < 0) report.errors.push('The roster needs a Student Grade column.');
    if (report.errors.length) return { sections: [], enrolments: [], report: report };

    var derived = null;
    if (m.grade_level < 0) {
      derived = gradesFromCourses(table.rows, m);
      report.gradesFromCourses = true;
      report.gradesMixed = derived.mixed;
    }

    var sections = {};
    var order = [];
    var enrolments = [];
    var seen = {};
    var studentGrade = {};
    var studentEmail = {};
    var fromPattern = {};
    var teachers = {};

    table.rows.forEach(function (row) {
      var num = U.clean(val(row, m.student_number));
      var grade = derived ? derived.grades[num] || '' : U.normGrade(val(row, m.grade_level));
      if (derived && !grade) {
        if (num) report.rowsNoGrade++;
        else report.rowsMissingStudent++;
        return;
      }
      if (s.grades.indexOf(grade) < 0) {
        report.rowsOutsideGrades++;
        return;
      }
      var course = U.clean(val(row, m.course_number)).toUpperCase();
      var cls = U.clean(val(row, m.class_name)).toUpperCase() || course;
      if (!cls) {
        report.rowsMissingClass++;
        return;
      }
      if (s.rosterSkip && s.rosterSkip.test(course || cls)) {
        report.rowsSkippedCourses++;
        bump(report.skippedCourses, course || cls);
        return;
      }
      if (!num) {
        report.rowsMissingStudent++;
        return;
      }

      var sec = sections[cls];
      if (!sec) {
        sec = sections[cls] = {
          section_id: cls, course_number: course || cls,
          course_name: U.clean(val(row, m.course_name)) || course || cls,
          section_number: U.clean(val(row, m.section_number)),
          teacher_emails: [], teacher_names: [], expression: U.clean(val(row, m.expression)),
          term: U.clean(val(row, m.term)), department: U.clean(val(row, m.department)),
          grades: {}, students: {}, status: ''
        };
        order.push(cls);
      }
      var temail = goodEmail(val(row, m.teacher_email)) || goodEmail(val(row, m.teacher_username));
      if (temail && sec.teacher_emails.indexOf(temail) < 0) {
        sec.teacher_emails.push(temail);
        sec.teacher_names.push(rosterTeacherName(row, m));
        teachers[temail] = true;
      }
      sec.grades[grade] = true;

      if (studentGrade[num] && studentGrade[num] !== grade) report.gradeConflicts++;
      studentGrade[num] = studentGrade[num] || grade;
      if (!studentEmail[num]) {
        var email = goodEmail(val(row, m.student_email));
        if (!email && s.studentEmailPattern) {
          email = emailFromPattern(s.studentEmailPattern, num, val(row, m.student_first), val(row, m.student_last));
          if (email) fromPattern[num] = true;
        }
        if (email) studentEmail[num] = email;
      }

      var from = U.normDate(val(row, m.date_enrolled));
      var k = num + '|' + cls + '|' + from;
      if (seen[k]) {
        report.duplicateRows++;
        return;
      }
      seen[k] = true;
      sec.students[num] = true;
      report.rowsKept++;
      enrolments.push({
        student_number: num, student_email: '', grade: studentGrade[num], section_id: cls,
        date_enrolled: from, date_left: U.normDate(val(row, m.date_left))
      });
    });

    // One email and one grade per student, whichever row they first came from.
    enrolments.forEach(function (en) {
      en.student_email = studentEmail[en.student_number] || '';
      en.grade = studentGrade[en.student_number];
    });

    var out = order.map(function (id) {
      var sec = sections[id];
      if (sec.teacher_emails.length > 1) report.coTaught++;
      if (!sec.teacher_emails.length && report.classesWithoutTeacher.length < 10) report.classesWithoutTeacher.push(id);
      return {
        section_id: sec.section_id, course_number: sec.course_number, course_name: sec.course_name,
        section_number: sec.section_number, teacher_emails: sec.teacher_emails.join(';'),
        teacher_names: sec.teacher_names.join(';'),
        expression: sec.expression, term: sec.term, department: sec.department,
        grades: U.sortGrades(Object.keys(sec.grades)).join(','), student_count: Object.keys(sec.students).length,
        status: ''
      };
    });

    report.sections = out.length;
    report.enrolments = enrolments.length;
    report.students = Object.keys(studentGrade).length;
    report.teachers = Object.keys(teachers).length;
    report.emailsFromPattern = Object.keys(fromPattern).length;
    report.studentsWithoutEmail = Object.keys(studentGrade).filter(function (n) { return !studentEmail[n]; }).length;
    if (!out.length) report.errors.push('No class in the roster has a student in grades ' + s.grades.join(', ') + '.');
    return { sections: out, enrolments: enrolments, report: report };
  }

  /* ------------------------------------------------------------------
     Source 2: two PowerSchool exports
     ------------------------------------------------------------------ */

  /** Pure core, so it can be tested without a Sheet. Returns { sections, enrolments, report }. */
  function build(secTable, enrTable, settings) {
    var s = settings;
    var report = {
      source: 'PS_Sections and PS_Enrolments tabs',
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
        student_count: 0,
        status: ''
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
      var email = goodEmail(val(row, em.student_email));
      if (!email) noEmail[num] = true;
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

  /* ------------------------------------------------------------------
     Loading
     ------------------------------------------------------------------ */

  /**
   * Classes that have bookings but are missing from the new data are kept,
   * marked RETIRED, so their entries still show with the right name. They have
   * no students any more, so they no longer count toward anyone's load.
   */
  function retiredSections(newSections) {
    var keep = U.toSet(newSections.map(function (x) { return x.section_id; }));
    var booked = {};
    Entries.all().forEach(function (e) {
      if (e.section_id && e.status !== 'CANCELLED') booked[e.section_id] = (booked[e.section_id] || 0) + 1;
    });
    var out = [];
    Store.all('Sections').forEach(function (r) {
      var id = U.clean(r.section_id);
      if (!id || keep[id] || !booked[id]) return;
      var o = {};
      Store.SCHEMAS.Sections.forEach(function (h) { o[h] = r[h]; });
      o.status = 'RETIRED';
      o.student_count = 0;
      o._bookings = booked[id];
      out.push(o);
    });
    return out;
  }

  /** Builds from the Roster tab if it has rows, otherwise from PS_Sections + PS_Enrolments. */
  function buildFromSheet(s) {
    var roster = Store.raw('Roster');
    return roster.rows.length ? buildRoster(roster, s) : build(Store.raw('PS_Sections'), Store.raw('PS_Enrolments'), s);
  }

  /**
   * Checks the uploaded data and, unless opts.dryRun, replaces Sections and
   * Enrolments with it. Course numbers new to the CourseNames tab are added
   * there so an admin can give them friendly names. Returns the report.
   */
  function process(opts) {
    opts = opts || {};
    var s = Config.get();
    var out = buildFromSheet(s);
    var r = out.report;
    r.dryRun = !!opts.dryRun;
    if (r.errors.length) return r;
    var retired = retiredSections(out.sections);
    r.retired = retired.map(function (x) { return x.section_id + ' (' + x._bookings + ' bookings)'; });
    var known = U.toSet(Store.all('CourseNames').map(function (c) { return U.clean(c.course_number).toUpperCase(); }));
    var newCourses = U.uniq(out.sections.map(function (x) { return U.clean(x.course_number).toUpperCase(); }))
      .filter(function (c) { return c && !known[c]; }).sort();
    r.coursesWithoutNames = newCourses.length;
    if (opts.dryRun) return r;
    Svc.withLock(function () {
      Store.replaceAll('Sections', out.sections.concat(retired.map(function (x) { delete x._bookings; return x; })));
      Store.replaceAll('Enrolments', out.enrolments);
      if (newCourses.length) {
        Store.append('CourseNames', newCourses.map(function (c) { return { course_number: c, course_name: '' }; }));
      }
      Store.append('Log', [{
        at: Svc.stamp(), user: Svc.userEmail(), action: 'ROSTER_IMPORT', ref: r.source,
        details: JSON.stringify(r).slice(0, 2000)
      }]);
    });
    Dir.reset();
    return r;
  }

  /** The report as plain lines for an alert box. */
  function describe(r) {
    if (r.errors.length) return (r.dryRun ? 'This would not load.' : 'Nothing was changed.') + '\n\n' + r.errors.join('\n');
    var lines = [
      (r.dryRun ? 'Loading would bring in ' : 'Loaded ') + r.sections + ' classes, ' + r.students + ' students and ' +
        r.enrolments + ' enrolments from the ' + r.source + '.'
    ];
    if (r.teachers) lines.push(r.teachers + ' teachers are linked to their classes and can book for them.');
    if (r.gradesFromCourses) {
      lines.push('There is no grade column, so each student\'s grade comes from their course numbers (G07ISA means Grade 7).' +
        (r.gradesMixed ? ' For ' + r.gradesMixed + ' students they point to more than one grade; the most common was used.' : ''));
    }
    if (r.rowsNoGrade) {
      lines.push(r.rowsNoGrade + ' rows were for students whose course numbers carry no grade, so they were left out. ' +
        'Add a grade column to bring them in.');
    }
    if (r.rowsOutsideGrades) lines.push(r.rowsOutsideGrades + ' rows were for other grades and were skipped.');
    if (r.rowsSkippedCourses) {
      lines.push(r.rowsSkippedCourses + ' rows were left out by Settings → roster_skip_courses: ' +
        Object.keys(r.skippedCourses).slice(0, 10).map(function (c) { return c + ' (' + r.skippedCourses[c] + ')'; }).join(', ') + '.');
    }
    if (r.rowsMissingClass) lines.push(r.rowsMissingClass + ' rows had no class and were skipped.');
    if (r.rowsMissingStudent) lines.push(r.rowsMissingStudent + ' rows had no Student ID and were skipped.');
    if (r.duplicateRows) lines.push(r.duplicateRows + ' repeated rows (e.g. one per co-teacher) were merged.');
    if (r.coTaught) lines.push(r.coTaught + ' classes have more than one teacher.');
    if (r.classesWithoutTeacher && r.classesWithoutTeacher.length) {
      lines.push('Classes with no usable teacher email (only SLT can book for them): ' + r.classesWithoutTeacher.join(', ') + '.');
    }
    if (r.emailsFromPattern) lines.push(r.emailsFromPattern + ' student emails were made from Settings → student_email_pattern.');
    if (r.studentsWithoutEmail) {
      lines.push(r.studentsWithoutEmail + ' students have no usable email, so they cannot sign in yet. ' +
        'Fix the Student Email column, or set Settings → student_email_pattern.');
    }
    if (r.gradeConflicts) lines.push(r.gradeConflicts + ' rows gave a student a different grade from their first row; the first was kept.');
    if (r.sectionsWithoutStudents) lines.push(r.sectionsWithoutStudents + ' sections had no students in these grades and were left out.');
    if (r.rowsUnknownSection) lines.push(r.rowsUnknownSection + ' enrolment rows named a section that is not in PS_Sections.');
    if (r.duplicateSections) lines.push(r.duplicateSections + ' duplicate section rows were ignored.');
    if (r.badTeacherEmails && r.badTeacherEmails.length) lines.push('Teacher emails that are not emails: ' + r.badTeacherEmails.join('; '));
    if (r.badExpressions && r.badExpressions.length) lines.push('Meeting patterns that could not be read: ' + r.badExpressions.join('; '));
    if (r.retired && r.retired.length) {
      lines.push('These classes have bookings but are not in the new data. They are kept so their entries still show, ' +
        'but their students no longer count toward the limit. If a class was renamed, move its bookings to the new class: ' +
        r.retired.slice(0, 10).join(', ') + '.');
    }
    if (r.coursesWithoutNames) {
      lines.push(r.coursesWithoutNames + ' course numbers have no friendly name yet. ' +
        (r.dryRun ? 'Loading adds them to the CourseNames tab.' : 'They have been added to the CourseNames tab: type a name next to any of them.'));
    }
    return lines.join('\n');
  }

  return {
    SECTION_FIELDS: SECTION_FIELDS, ENROLMENT_FIELDS: ENROLMENT_FIELDS, ROSTER_FIELDS: ROSTER_FIELDS,
    mapHeaders: mapHeaders, goodEmail: goodEmail, emailFromPattern: emailFromPattern,
    build: build, buildRoster: buildRoster, process: process, describe: describe
  };
})();
