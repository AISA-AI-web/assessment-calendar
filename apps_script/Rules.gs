/**
 * Rules.gs: the load engine and the booking rules.
 *
 * Load is counted per student, never per class: for every day, how many
 * summatives (and exams) each student has, using the PowerSchool enrolments.
 * A grade or class "load" is its busiest student's count.
 *
 * Issue levels, worst first:
 *   INVALID: nobody can save (not a school day, no such period, not your class)
 *   BLOCK:   policy. Teachers cannot save; they can ask SLT, who can override
 *   WARN:    shown to the teacher; saving is allowed
 * The client never computes any of this. It only renders what comes back.
 */
var Rules = (function () {
  'use strict';

  var LEVEL = { OK: 0, WARN: 1, BLOCK: 2, INVALID: 3 };

  function isSlt(user) { return user.role === 'SLT' || user.role === 'ADMIN'; }

  /** Student numbers an entry applies to on a date. */
  function studentsOf(entry, date) {
    if (entry.section_id) return Dir.studentsInSection(entry.section_id, date || entry.date);
    if (entry.grade) return Dir.studentsInGrade(entry.grade);
    return [];
  }

  function gradesOf(entry) {
    if (entry.section_id) {
      var sec = Dir.section(entry.section_id);
      return sec ? sec.grades : [];
    }
    return entry.grade ? [entry.grade] : [];
  }

  /** date → student → [entry ids], over ACTIVE entries in counted categories. */
  function countMap(entries, from, to, exclude) {
    var out = {};
    entries.forEach(function (e) {
      if (e.status !== 'ACTIVE' || !Config.isCounted(e.category)) return;
      if (exclude && exclude[e.id]) return;
      if (e.date < from || e.date > to) return;
      var day = out[e.date] || (out[e.date] = {});
      studentsOf(e, e.date).forEach(function (sid) { (day[sid] = day[sid] || []).push(e.id); });
    });
    return out;
  }

  function scopeStudents(scope, date) {
    if (scope.kind === 'grade') return Dir.studentsInGrade(scope.grade);
    if (scope.kind === 'section') return Dir.studentsInSection(scope.sectionId, date);
    if (scope.kind === 'student') return [scope.studentId];
    return null;
  }

  /**
   * Per-day load for a scope:
   *   { cap, days: { date: { max, at, over } } }
   * max is the busiest student's count; at/over count students at or above the cap.
   */
  function loadFor(scope, from, to, entries) {
    var cap = Config.get().maxPerDay;
    var counts = countMap(entries, from, to, null);
    var days = {};
    Object.keys(counts).forEach(function (date) {
      var day = counts[date];
      var ids = scopeStudents(scope, date) || Object.keys(day);
      var max = 0;
      var at = 0;
      var over = 0;
      ids.forEach(function (sid) {
        var n = day[sid] ? day[sid].length : 0;
        if (n > max) max = n;
        if (n === cap) at++;
        if (n > cap) over++;
      });
      if (max) days[date] = { max: max, at: at, over: over };
    });
    return { cap: cap, days: days };
  }

  function issue(code, level, title, detail, extra) {
    var x = { code: code, level: level, title: title, detail: detail || '' };
    if (extra) Object.keys(extra).forEach(function (k) { x[k] = extra[k]; });
    return x;
  }

  function targetLabel(row) {
    if (row.sectionId) return Dir.label(Dir.section(row.sectionId)) || 'This class';
    return 'Grade ' + row.grade;
  }

  function targetStudents(row) {
    if (row.sectionId) return Dir.studentsInSection(row.sectionId, row.date);
    if (row.grade) return Dir.studentsInGrade(row.grade);
    return [];
  }

  function clashInfo(e, n) {
    var sec = e.section_id ? Dir.section(e.section_id) : null;
    return {
      id: e.id, title: e.title, category: e.category, status: e.status, date: e.date,
      periods: e.periods, label: sec ? Dir.label(sec) : 'All of Grade ' + e.grade,
      teacherName: Dir.teacherName(e.teacher_email), students: n
    };
  }

  /** Periods a section meets on a date, or null when that cannot be known. */
  function meetingPeriods(sec, date) {
    var day = Days.day(date);
    if (!sec || !sec.meetings.length || !day.rotation) return null;
    var valid = Days.periodsFor(date).map(function (p) { return p.p; });
    return sec.meetings.filter(function (m) {
      return m.day === day.rotation && valid.indexOf(m.period) >= 0;
    }).map(function (m) { return m.period; });
  }

  /** The next dates (up to n) on which this booking would pass every policy check. */
  function suggest(row, sec, grades, category, entries, exclude, n) {
    var s = Config.get();
    var from = U.addDays(row.date, 1);
    var to = U.addDays(row.date, 35);
    if (to > s.yearEnd) to = s.yearEnd;
    if (from > to) return [];
    var counts = countMap(entries, from, to, exclude);
    var counted = Config.isCounted(category);
    var out = [];
    U.range(from, to).some(function (d) {
      var day = Days.day(d);
      if (day.status !== 'SCHOOL') return false;
      if (sec && sec.termStart && (d < sec.termStart || d > sec.termEnd)) return false;
      var blocked = Days.eventsFor(d, grades).some(function (ev) {
        return ev.category === 'NO_ASSESSMENTS' || (ev.category === 'EXAM_WINDOW' && category !== 'EXAM');
      });
      if (blocked) return false;
      var meets = meetingPeriods(sec, d);
      if (meets && !meets.length) return false;
      var busiest = 0;
      if (counted) {
        var dayCounts = counts[d] || {};
        targetStudents({ sectionId: row.sectionId, grade: row.grade, date: d }).forEach(function (sid) {
          busiest = Math.max(busiest, (dayCounts[sid] || []).length);
        });
        if (busiest + 1 > s.maxPerDay) return false;
      }
      out.push({ date: d, rotation: day.rotation, periods: meets || [], busiest: busiest });
      return out.length >= n;
    });
    return out;
  }

  /**
   * Checks a sanitised draft (see Entries.sanitize):
   *   { category, rows: [{ sectionId, grade, date, periods }], excludeIds }
   * Returns { verdict, rows: [...], cap, enforcement, canOverride, canRequest, needsReason }.
   */
  function evaluate(draft, user, options) {
    options = options || {};
    var s = Config.get();
    var entries = options.entries || Entries.all();
    var exclude = U.toSet(draft.excludeIds || []);
    var counted = Config.isCounted(draft.category);
    var byId = {};
    entries.forEach(function (e) { byId[e.id] = e; });

    var dates = draft.rows.map(function (r) { return r.date; }).filter(U.isYmd).sort();
    var counts = dates.length ? countMap(entries, dates[0], dates[dates.length - 1], exclude) : {};

    // Rows of the same booking count against each other.
    var draftCounts = {};
    if (counted) {
      draft.rows.forEach(function (r, i) {
        if (!U.isYmd(r.date)) return;
        var day = draftCounts[r.date] || (draftCounts[r.date] = {});
        targetStudents(r).forEach(function (sid) { (day[sid] = day[sid] || []).push(i); });
      });
    }

    var category = Config.category(draft.category);

    var rows = draft.rows.map(function (r, i) {
      var out = {
        index: i, verdict: 'OK', issues: [], load: null, affected: null,
        clashes: [], suggestions: [], meeting: null, rotation: null
      };
      function add(x) {
        out.issues.push(x);
        if (LEVEL[x.level] > LEVEL[out.verdict]) out.verdict = x.level;
      }

      var sec = r.sectionId ? Dir.section(r.sectionId) : null;
      var grades = sec ? sec.grades : (r.grade ? [r.grade] : []);
      var label = targetLabel(r);
      // Student emails go only to SLT and to the class's own teachers.
      var mayNameStudents = isSlt(user) || (!!sec && sec.teachers.indexOf(user.email) >= 0);

      // 1. Who may book what
      if (r.sectionId && !sec) {
        add(issue('UNKNOWN_CLASS', 'INVALID', 'This class is not in the timetable data.'));
        return out;
      }
      if (!r.sectionId && !r.grade) {
        add(issue('NO_CLASS', 'INVALID', 'Choose a class.'));
        return out;
      }
      if (!r.sectionId && !isSlt(user)) {
        add(issue('GRADE_SLT_ONLY', 'INVALID', 'Only SLT can book for a whole grade.'));
      }
      if (sec && user.role === 'TEACHER' && !s.teachersBookAnySection && sec.teachers.indexOf(user.email) < 0) {
        add(issue('NOT_YOUR_CLASS', 'INVALID', 'You can only book for classes you teach.',
          'PowerSchool lists ' + (sec.teachers.map(Dir.teacherName).join(' and ') || 'nobody') + ' for ' + label + '.'));
      }
      if (category && category.sltOnly && !isSlt(user)) {
        add(issue('EXAM_SLT_ONLY', 'INVALID', 'Only SLT can schedule exams.'));
      }

      // 2. The day
      if (!U.isYmd(r.date)) {
        add(issue('NO_DATE', 'INVALID', 'Choose a date.'));
        return out;
      }
      var day = Days.day(r.date);
      var when = U.human(r.date);
      out.rotation = day.rotation;
      if (day.status === 'OUTSIDE') {
        add(issue('OUTSIDE_YEAR', 'INVALID', when + ' is outside the school year.'));
        return out;
      }
      if (day.status === 'WEEKEND') {
        add(issue('WEEKEND', 'INVALID', when + ' is a weekend.'));
        return out;
      }
      if (day.status === 'CLOSED') {
        add(issue('CLOSED', 'INVALID', 'There is no school on ' + when + '.', day.label));
        return out;
      }
      if (day.status === 'UNLISTED') {
        add(issue('NO_ROTATION_DAY', 'WARN', 'The Internal Calendar has no rotation day for ' + when + '.',
          'It may be a holiday that has not been added yet. Check before telling students.'));
      }

      // 3. Periods
      var valid = Days.periodsFor(r.date).map(function (p) { return p.p; });
      var bad = r.periods.filter(function (p) { return valid.indexOf(p) < 0; });
      if (bad.length) {
        add(issue('NO_SUCH_PERIOD', 'INVALID', 'There is no period ' + bad.join(', ') + ' on ' + when + '.',
          'That day has periods ' + valid.join(', ') + '.'));
      }

      // 4. Term and meeting pattern
      if (sec) {
        if (sec.termStart && (r.date < sec.termStart || r.date > sec.termEnd)) {
          add(issue('OUTSIDE_TERM', 'WARN', label + ' does not run on ' + when + '.',
            'Its term (' + sec.term + ') runs ' + U.human(sec.termStart) + ' to ' + U.human(sec.termEnd) + '.'));
        }
        var meets = meetingPeriods(sec, r.date);
        if (meets) {
          out.meeting = { rotation: day.rotation, periods: meets };
          if (!meets.length) {
            add(issue('CLASS_NOT_MEETING', 'WARN', label + ' does not meet on Day ' + day.rotation + '.',
              'It meets ' + Dir.describeMeetings(sec.meetings) + '.'));
          } else if (r.periods.length && r.periods.some(function (p) { return meets.indexOf(p) < 0; })) {
            add(issue('PERIOD_MISMATCH', 'WARN', label + ' meets in P' + meets.join(' and P') + ' on Day ' + day.rotation + '.'));
          }
        }
      }

      // 5. What else is happening for these grades
      Days.eventsFor(r.date, grades).forEach(function (ev) {
        var overlaps = ev.allDay || !ev.periods.length || !r.periods.length ||
          r.periods.some(function (p) { return ev.periods.indexOf(p) >= 0; });
        var at = ev.periods.length && !ev.allDay ? ' (P' + ev.periods.join(', P') + ')' : '';
        if (ev.category === 'NO_ASSESSMENTS' && overlaps) {
          add(issue('NO_ASSESSMENT_DAY', 'BLOCK', 'No assessments on ' + when + ': ' + ev.title + '.'));
        } else if (ev.category === 'EXAM_WINDOW' && draft.category !== 'EXAM') {
          add(issue('EXAM_WINDOW', 'BLOCK', when + ' is in ' + ev.title + '.', 'Only exams can be booked in an exam window.'));
        } else if (ev.category === 'TESTING' && overlaps) {
          add(issue('TESTING', 'WARN', ev.title + at + ' on ' + when + '.', 'External testing for this grade.'));
        } else if (ev.category === 'CAUTION' && overlaps) {
          add(issue('CAUTION', 'WARN', ev.title + at + ' on ' + when + '.', 'Some students may be out of class.'));
        }
      });

      // 6. The daily limit, per student
      var students = targetStudents(r);
      if (!students.length) {
        add(issue('NO_STUDENT_DATA', 'WARN', 'No enrolment data for ' + label + ', so student load cannot be checked.'));
      }
      if (counted && students.length) {
        var dayCounts = counts[r.date] || {};
        var mine = draftCounts[r.date] || {};
        var before = 0;
        var after = 0;
        var affected = [];
        var clash = {};
        var rowClash = {};
        students.forEach(function (sid) {
          var existing = dayCounts[sid] || [];
          var others = (mine[sid] || []).filter(function (j) { return j !== i; });
          var n = existing.length + others.length + 1;
          before = Math.max(before, existing.length);
          after = Math.max(after, n);
          if (n > s.maxPerDay) {
            affected.push(sid);
            existing.forEach(function (id) { clash[id] = (clash[id] || 0) + 1; });
            others.forEach(function (j) { rowClash[j] = (rowClash[j] || 0) + 1; });
          }
        });
        out.load = { before: before, after: after, cap: s.maxPerDay, students: students.length };
        if (affected.length && s.enforcement !== 'OFF') {
          var n = affected.length;
          add(issue('DAY_CAP', s.enforcement === 'BLOCK' ? 'BLOCK' : 'WARN',
            n + (n === 1 ? ' student' : ' students') + ' would have ' + after + ' summatives on ' + when + '.',
            'The limit is ' + s.maxPerDay + ' per student per day.',
            s.enforcement === 'WARN' ? { needsReason: true } : null));
          out.affected = {
            count: n,
            emails: mayNameStudents ? affected.map(function (sid) {
              var st = Dir.student(sid);
              return st && st.email ? st.email : sid;
            }).sort() : []
          };
          out.clashes = Object.keys(clash).map(function (id) { return clashInfo(byId[id], clash[id]); })
            .sort(function (a, b) { return b.students - a.students; });
          Object.keys(rowClash).forEach(function (j) {
            out.clashes.push({ id: null, row: +j, title: 'Another class in this booking',
              label: targetLabel(draft.rows[+j]), students: rowClash[j] });
          });
        }
      }

      // 7. Alternatives when policy blocks the date
      if (out.verdict === 'BLOCK' && !options.noSuggestions) {
        out.suggestions = suggest(r, sec, grades, draft.category, entries, exclude, 3);
      }
      return out;
    });

    var verdict = 'OK';
    rows.forEach(function (r) { if (LEVEL[r.verdict] > LEVEL[verdict]) verdict = r.verdict; });
    var needsReason = rows.some(function (r) {
      return r.issues.some(function (x) { return x.needsReason; });
    });
    return {
      verdict: verdict,
      rows: rows,
      cap: s.maxPerDay,
      enforcement: s.enforcement,
      canOverride: verdict === 'BLOCK' && isSlt(user),
      canRequest: verdict === 'BLOCK' && user.role === 'TEACHER',
      needsReason: needsReason
    };
  }

  return {
    LEVEL: LEVEL, isSlt: isSlt, studentsOf: studentsOf, gradesOf: gradesOf,
    countMap: countMap, loadFor: loadFor, evaluate: evaluate, suggest: suggest,
    meetingPeriods: meetingPeriods
  };
})();
