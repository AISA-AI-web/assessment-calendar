/**
 * Config.gs: settings, constants and the defaults written by Set up.
 *
 * Every school-specific value lives in the Settings tab of the Sheet, never in
 * this file. This repository is public, and the same code is deployed once per
 * division (6–12 now, K–5 later), each with its own Sheet.
 */
var Config = (function () {
  'use strict';

  /** [key, default, note]. Set up adds any missing key to the Settings tab. */
  var DEFAULTS = [
    ['app_title', 'Assessment Calendar', 'Shown in the header and the browser tab.'],
    ['division_label', 'Grades 6–12', 'Shown under the title.'],
    ['grades', '6,7,8,9,10,11,12', 'Grades this deployment covers.'],
    ['year_start', '2026-08-31', 'First day of the school year (yyyy-mm-dd).'],
    ['year_end', '2027-07-02', 'Last day of the school year (yyyy-mm-dd).'],
    ['semester1_start', '2026-08-31', 'Used for sections whose term is S1.'],
    ['semester1_end', '2027-02-05', ''],
    ['semester2_start', '2027-02-08', 'Used for sections whose term is S2.'],
    ['semester2_end', '2027-07-02', ''],
    ['max_summatives_per_day', '2', 'Most summatives (including exams) one student may have on one day.'],
    ['enforcement', 'BLOCK', 'BLOCK: teachers cannot save past the limit; SLT can override. WARN: anyone can save with a reason. OFF: show the load only.'],
    ['internal_calendar_id', '', 'Calendar ID of the AISA (Internal Calendar). Blank = find it by the name below.'],
    ['internal_calendar_name', 'AISA (Internal Calendar)', ''],
    ['rotation_pattern', '^MS\\s*/\\s*HS\\s+Day\\s+(\\d+)$', 'Regular expression matching rotation-day events; group 1 is the day number.'],
    ['grade_calendar_6', '', 'Calendar ID of the Grade 6 assessment calendar.'],
    ['grade_calendar_7', '', ''],
    ['grade_calendar_8', '', ''],
    ['grade_calendar_9', '', ''],
    ['grade_calendar_10', '', ''],
    ['grade_calendar_11', '', ''],
    ['grade_calendar_12', '', ''],
    ['mirror_enabled', 'TRUE', 'Copy every entry to its grade calendar.'],
    ['mirror_unannounced', 'TRUE', 'TRUE: copy entries before they are announced (grade calendars are staff-only). FALSE: copy only announced entries.'],
    ['teachers_book_any_section', 'FALSE', 'TRUE lets teachers book for sections they do not teach.'],
    ['show_formatives_to_students', 'TRUE', ''],
    ['support_email', '', 'Shown to anyone who needs help or access.'],
    ['slt_notify_emails', '', 'Emailed about override requests. Blank = everyone with role SLT in the Staff tab.'],
    ['day_letter_map', '', 'Letters A–J in PowerSchool expressions already mean Days 1–10. Only if yours differ, e.g. A=2,B=3.'],
    ['student_email_pattern', '', 'Used when the roster has no usable student email, e.g. {id}@aisa.sch.ae. Tokens: {id}, {first}, {last}.'],
    ['roster_skip_courses', '^[A-Z]?HR\\d*$', 'Course numbers the roster import leaves out (a regular expression). Default: homerooms such as HHR.'],
    ['import_from', '', 'Import old grade-calendar events dated from this day (yyyy-mm-dd). Blank = today.'],
    ['app_url', '', 'The web app URL, used in emails and calendar descriptions. Blank = detect automatically.']
  ];

  var CATEGORIES = [
    { code: 'SUMMATIVE', label: 'Summative', short: 'SUM', sltOnly: false },
    { code: 'EXAM', label: 'Exam', short: 'EXM', sltOnly: true },
    { code: 'FORMATIVE', label: 'Formative', short: 'FRM', sltOnly: false }
  ];

  /** Categories that count toward the per-student daily limit. */
  var COUNTED = ['SUMMATIVE', 'EXAM'];

  var FORMATS = ['Test', 'Essay / written task', 'Lab / practical', 'Project', 'Presentation',
    'Oral', 'Quiz', 'Performance', 'Other'];

  var ROLES = ['ADMIN', 'SLT', 'TEACHER', 'VIEWER'];

  /** Secondary bell times, 2026–27. [schedule, from, to, weekdays, period, start, end] */
  var DEFAULT_BELLS = [
    ['Regular', '', '', 'MON-THU', '1', '07:55', '08:45'],
    ['Regular', '', '', 'MON-THU', '2', '08:50', '09:40'],
    ['Regular', '', '', 'MON-THU', '3', '09:45', '10:35'],
    ['Regular', '', '', 'MON-THU', '4', '11:00', '11:50'],
    ['Regular', '', '', 'MON-THU', '5', '11:55', '12:45'],
    ['Regular', '', '', 'MON-THU', '6', '13:10', '14:00'],
    ['Regular', '', '', 'MON-THU', '7', '14:05', '14:55'],
    ['Regular', '', '', 'FRI', '1', '07:40', '08:30'],
    ['Regular', '', '', 'FRI', '2', '08:35', '09:25'],
    ['Regular', '', '', 'FRI', '3', '09:45', '10:35'],
    ['Regular', '', '', 'FRI', '4', '10:40', '11:30']
  ];

  var cache = null;

  function get() {
    if (cache) return cache;
    var raw = {};
    DEFAULTS.forEach(function (d) { raw[d[0]] = d[1]; });
    Store.all('Settings').forEach(function (r) {
      var k = U.clean(r.key);
      if (!k) return;
      var v = r.value;
      raw[k] = U.isDate(v) ? U.normDate(v) : U.clean(v);
    });
    cache = typed(raw);
    return cache;
  }

  function date(v, fallback) { return U.normDate(v) || fallback; }

  function safeRegex(p) {
    try { return p ? new RegExp(U.clean(p), 'i') : null; } catch (e) { return null; }
  }

  function defaultOf(key) {
    for (var i = 0; i < DEFAULTS.length; i++) if (DEFAULTS[i][0] === key) return DEFAULTS[i][1];
    return '';
  }

  function typed(raw) {
    var grades = U.splitList(raw.grades).map(U.normGrade);
    var s = {
      appTitle: raw.app_title || 'Assessment Calendar',
      divisionLabel: raw.division_label || '',
      grades: grades,
      yearStart: date(raw.year_start, '2026-08-31'),
      yearEnd: date(raw.year_end, '2027-07-02'),
      semester1: [date(raw.semester1_start, ''), date(raw.semester1_end, '')],
      semester2: [date(raw.semester2_start, ''), date(raw.semester2_end, '')],
      maxPerDay: Math.max(1, parseInt(raw.max_summatives_per_day, 10) || 2),
      enforcement: /^(BLOCK|WARN|OFF)$/i.test(raw.enforcement) ? raw.enforcement.toUpperCase() : 'BLOCK',
      internalCalendarId: U.clean(raw.internal_calendar_id),
      internalCalendarName: U.clean(raw.internal_calendar_name),
      rotationPattern: raw.rotation_pattern || defaultOf('rotation_pattern'),
      gradeCalendars: {},
      mirrorEnabled: U.bool(raw.mirror_enabled),
      mirrorUnannounced: U.bool(raw.mirror_unannounced),
      teachersBookAnySection: U.bool(raw.teachers_book_any_section),
      showFormativesToStudents: U.bool(raw.show_formatives_to_students),
      supportEmail: U.normEmail(raw.support_email),
      sltNotifyEmails: U.splitList(raw.slt_notify_emails).map(U.normEmail),
      dayLetterMap: parseLetterMap(raw.day_letter_map),
      studentEmailPattern: U.clean(raw.student_email_pattern),
      rosterSkip: safeRegex(raw.roster_skip_courses),
      importFrom: U.normDate(raw.import_from),
      appUrl: U.clean(raw.app_url),
      counted: COUNTED.slice(),
      raw: raw
    };
    grades.forEach(function (g) { s.gradeCalendars[g] = U.clean(raw['grade_calendar_' + g]); });
    return s;
  }

  /** 'A=1,B=2' → { A: 1, B: 2 }. Default: A=1 … J=10. */
  function parseLetterMap(text) {
    var map = {};
    'ABCDEFGHIJ'.split('').forEach(function (c, i) { map[c] = i + 1; });
    U.splitList(text).forEach(function (pair) {
      var m = pair.match(/^([A-Za-z])\s*=\s*(\d{1,2})$/);
      if (m) map[m[1].toUpperCase()] = +m[2];
    });
    return map;
  }

  function category(code) {
    for (var i = 0; i < CATEGORIES.length; i++) if (CATEGORIES[i].code === code) return CATEGORIES[i];
    return null;
  }

  function isCounted(code) { return COUNTED.indexOf(code) >= 0; }

  function reset() { cache = null; }

  return {
    DEFAULTS: DEFAULTS, CATEGORIES: CATEGORIES, FORMATS: FORMATS, ROLES: ROLES,
    DEFAULT_BELLS: DEFAULT_BELLS, get: get, typed: typed, category: category,
    isCounted: isCounted, reset: reset
  };
})();
