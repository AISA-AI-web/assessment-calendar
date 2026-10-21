/**
 * Directory.gs: who is who, and which students are in which class.
 *
 * Roles, in order of precedence:
 *   1. the Staff tab (ADMIN, SLT, TEACHER, VIEWER),
 *   2. anyone listed as a section teacher in the PowerSchool export → TEACHER,
 *   3. anyone listed as a student in the enrolment export → STUDENT,
 *   4. everyone else → NONE (no access).
 *
 * Enrolments carry optional start and end dates, so a student who changes
 * class mid-year counts toward the right class on the right days. PowerSchool's
 * DateLeft is the first day the student is no longer enrolled.
 */
var Dir = (function () {
  'use strict';

  var idx = null;

  function load() {
    if (idx) return idx;
    var s = Config.get();

    var staff = {};
    Store.all('Staff').forEach(function (r) {
      var email = U.normEmail(r.email);
      if (!email) return;
      var role = U.clean(r.role).toUpperCase();
      if (Config.ROLES.indexOf(role) < 0) role = 'TEACHER';
      staff[email] = { email: email, name: U.clean(r.name), role: role };
    });

    // Friendly course names an admin typed into the CourseNames tab apply straight away.
    var courseNames = {};
    Store.all('CourseNames').forEach(function (c) {
      var code = U.clean(c.course_number).toUpperCase();
      var name = U.clean(c.course_name);
      if (code && name) courseNames[code] = name;
    });

    var names = {};
    var sections = {};
    var byTeacher = {};
    Store.all('Sections').forEach(function (r) {
      var id = U.clean(r.section_id);
      if (!id) return;
      var teachers = U.splitList(r.teacher_emails).map(U.normEmail);
      var tnames = String(r.teacher_names || '').split(';').map(U.clean);
      teachers.forEach(function (t, i) { if (tnames[i] && !names[t]) names[t] = tnames[i]; });
      var term = U.clean(r.term);
      var tr = termRange(term, s);
      var courseNumber = U.clean(r.course_number);
      var retired = U.clean(r.status).toUpperCase() === 'RETIRED';
      sections[id] = {
        id: id,
        courseNumber: courseNumber,
        courseName: courseNames[courseNumber.toUpperCase()] || U.clean(r.course_name) || courseNumber,
        retired: retired,
        sectionNumber: U.clean(r.section_number),
        teachers: teachers,
        expression: U.clean(r.expression),
        meetings: parseExpression(r.expression, s.dayLetterMap),
        term: term,
        termStart: tr[0],
        termEnd: tr[1],
        department: U.clean(r.department),
        grades: U.splitList(r.grades).map(U.normGrade)
      };
      // A retired class keeps its name for old bookings but leaves teachers' class lists.
      if (!retired) teachers.forEach(function (t) { (byTeacher[t] = byTeacher[t] || []).push(id); });
    });

    var students = {};
    var byEmail = {};
    var bySection = {};
    var byGrade = {};
    Store.all('Enrolments').forEach(function (r) {
      var num = U.clean(r.student_number);
      var sid = U.clean(r.section_id);
      if (!num || !sid) return;
      var st = students[num];
      if (!st) {
        st = students[num] = { id: num, email: U.normEmail(r.student_email), grade: U.normGrade(r.grade), sections: [] };
        if (st.email) byEmail[st.email] = st;
        (byGrade[st.grade] = byGrade[st.grade] || []).push(num);
      }
      var en = { s: num, from: U.normDate(r.date_enrolled), to: U.normDate(r.date_left) };
      (bySection[sid] = bySection[sid] || []).push(en);
      st.sections.push({ id: sid, from: en.from, to: en.to });
    });

    Object.keys(sections).forEach(function (id) {
      var sec = sections[id];
      var list = bySection[id] || [];
      sec.studentCount = U.uniq(list.map(function (en) { return en.s; })).length;
      if (!sec.grades.length) {
        sec.grades = U.sortGrades(U.uniq(list.map(function (en) { return students[en.s].grade; })));
      }
      // A class runs only while it has students, so a semester class ends with its
      // enrolments even when its term is a PowerSchool TermID such as 3601.
      var span = enrolmentSpan(list);
      if (span[0] > sec.termStart) sec.termStart = span[0];
      if (span[1] && span[1] < sec.termEnd) sec.termEnd = span[1];
    });

    Object.keys(staff).forEach(function (e) { if (staff[e].name) names[e] = staff[e].name; });

    idx = {
      staff: staff, names: names, sections: sections, byTeacher: byTeacher,
      students: students, byEmail: byEmail, bySection: bySection, byGrade: byGrade
    };
    return idx;
  }

  /** [first day, last day] anyone is enrolled, each '' unless every enrolment gives that date. */
  function enrolmentSpan(list) {
    var from = '';
    var to = '';
    var allFrom = list.length > 0;
    var allTo = list.length > 0;
    list.forEach(function (en) {
      if (!en.from) allFrom = false;
      else if (!from || en.from < from) from = en.from;
      if (!en.to) allTo = false;
      else if (!to || en.to > to) to = en.to;
    });
    return [allFrom ? from : '', allTo ? U.addDays(to, -1) : ''];
  }

  /* ------------------------------------------------------------------
     PowerSchool meeting patterns
     ------------------------------------------------------------------ */

  function expandPeriods(text) {
    var out = [];
    String(text).split(',').forEach(function (tok) {
      tok = tok.trim().replace(/^P(?=\d)/i, '');
      var m = tok.match(/^(\d+)\s*-\s*P?(\d+)$/i);
      if (m) {
        for (var p = +m[1]; p <= +m[2] && p - +m[1] < 20; p++) out.push(String(p));
      } else if (tok) {
        out.push(tok.toUpperCase());
      }
    });
    return out;
  }

  function dayNumber(tok, letterMap) {
    tok = tok.trim().replace(/^D(?=\d)/i, '');
    if (/^\d+$/.test(tok)) return +tok;
    var n = letterMap && letterMap[tok.toUpperCase()];
    return n || null;
  }

  function expandDays(text, letterMap) {
    var out = [];
    String(text).split(',').forEach(function (tok) {
      var ends = tok.split('-');
      var a = dayNumber(ends[0], letterMap);
      var b = ends.length > 1 ? dayNumber(ends[1], letterMap) : a;
      if (!a || !b) return;
      for (var d = a; d <= b && d - a < 20; d++) out.push(d);
    });
    return out;
  }

  /**
   * '3(1,4,7) 5(9)', '3(D1,D4,D7)', '1-2(A-C)', 'P3(1-5)' →
   * [{ day: 1, period: '3' }, …] sorted by day then period.
   */
  function parseExpression(expr, letterMap) {
    var out = [];
    var seen = {};
    var re = /([^()\s]+)\s*\(([^)]*)\)/g;
    var text = U.clean(expr);
    var m;
    while ((m = re.exec(text))) {
      var periods = expandPeriods(m[1]);
      var days = expandDays(m[2], letterMap);
      periods.forEach(function (p) {
        days.forEach(function (d) {
          var k = d + ':' + p;
          if (seen[k]) return;
          seen[k] = true;
          out.push({ day: d, period: p });
        });
      });
    }
    return out.sort(function (a, b) {
      return a.day - b.day || (parseInt(a.period, 10) || 0) - (parseInt(b.period, 10) || 0);
    });
  }

  /** 'P3 on Days 1, 4, 7 · P5 on Day 9' */
  function describeMeetings(meetings) {
    var byPeriod = {};
    meetings.forEach(function (m) { (byPeriod[m.period] = byPeriod[m.period] || []).push(m.day); });
    return Object.keys(byPeriod).sort(function (a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0); })
      .map(function (p) {
        var d = byPeriod[p];
        return 'P' + p + ' on Day' + (d.length > 1 ? 's ' : ' ') + d.join(', ');
      }).join(' · ');
  }

  /** [start, end] of a PowerSchool term code. S1/S2 use the semester settings. */
  function termRange(term, s) {
    s = s || Config.get();
    if (/(^|[^A-Z0-9])S(EM(ESTER)?)?\s*1($|[^0-9])/i.test(term) && s.semester1[0]) return s.semester1;
    if (/(^|[^A-Z0-9])S(EM(ESTER)?)?\s*2($|[^0-9])/i.test(term) && s.semester2[0]) return s.semester2;
    return [s.yearStart, s.yearEnd];
  }

  /* ------------------------------------------------------------------
     Lookups
     ------------------------------------------------------------------ */

  function section(id) { return load().sections[id] || null; }

  function covers(en, date) {
    return (!en.from || en.from <= date) && (!en.to || date < en.to);
  }

  /** Student numbers enrolled in a section on a date. */
  function studentsInSection(id, date) {
    var list = load().bySection[id] || [];
    var out = [];
    var seen = {};
    list.forEach(function (en) {
      if (seen[en.s] || (date && !covers(en, date))) return;
      seen[en.s] = true;
      out.push(en.s);
    });
    return out;
  }

  function studentsInGrade(grade) { return (load().byGrade[grade] || []).slice(); }

  function student(id) { return load().students[id] || null; }

  function isEnrolled(studentId, sectionId, date) {
    var st = student(studentId);
    return !!st && st.sections.some(function (x) { return x.id === sectionId && covers(x, date); });
  }

  /**
   * 'Visual Arts 9 (G09ART.1)' for PowerSchool sections numbered 1, 2, …; where
   * the section number is already a class code, as at AISA, or for roster
   * classes, the code: 'Arabic Second Language 12 (12ASL1)', or just 'IB1ENGSL1'
   * until the course has a friendly name in the CourseNames tab.
   */
  function label(sec) {
    if (!sec) return '';
    var num = sec.sectionNumber;
    var code = num ? (/^\d+$/.test(num) ? sec.courseNumber + '.' + num : num) :
      (/^\d+$/.test(sec.id) ? sec.courseNumber : sec.id);
    if (!code || code === sec.courseName) return sec.courseName;
    if (sec.courseName === sec.courseNumber) return code;
    return sec.courseName + ' (' + code + ')';
  }

  function teacherName(email) {
    if (!email) return '';
    var d = load();
    return d.names[email] || email.split('@')[0];
  }

  /** The signed-in person: { email, name, role, sectionIds, studentId?, grade? }. */
  function userFor(email) {
    var d = load();
    var e = U.normEmail(email);
    if (!e) return { email: '', name: '', role: 'NONE', sectionIds: [] };
    var st = d.staff[e];
    if (st) return { email: e, name: st.name || teacherName(e), role: st.role, sectionIds: d.byTeacher[e] || [] };
    if (d.byTeacher[e]) return { email: e, name: teacherName(e), role: 'TEACHER', sectionIds: d.byTeacher[e] };
    var stu = d.byEmail[e];
    if (stu) {
      return {
        email: e, name: e.split('@')[0], role: 'STUDENT', studentId: stu.id, grade: stu.grade,
        sectionIds: U.uniq(stu.sections.map(function (x) { return x.id; }))
      };
    }
    return { email: e, name: '', role: 'NONE', sectionIds: [] };
  }

  function reset() { idx = null; }

  return {
    load: load, parseExpression: parseExpression, describeMeetings: describeMeetings,
    termRange: termRange, section: section, studentsInSection: studentsInSection,
    studentsInGrade: studentsInGrade, student: student, isEnrolled: isEnrolled,
    label: label, teacherName: teacherName, userFor: userFor, reset: reset
  };
})();
