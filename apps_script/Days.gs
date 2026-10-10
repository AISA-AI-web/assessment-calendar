/**
 * Days.gs: the school-day model, built from the AISA (Internal Calendar).
 *
 * An hourly trigger copies the Internal Calendar into the InternalEvents tab and
 * classifies each event with the rules in the CalendarRules tab (first match
 * wins). Admins can correct any single event with override_category or
 * override_grades; a sync keeps those corrections.
 *
 * From those rows this file answers, for every weekday of the school year:
 *   - which rotation day it is (from the "MS/ HS Day N" events: never computed,
 *     because holidays skip numbers: Day 10 on 9 Oct is followed by Day 3),
 *   - whether students are in school (CLOSED / SCHOOL / UNLISTED),
 *   - which events matter to which grades,
 *   - which bell schedule applies.
 */
var Days = (function () {
  'use strict';

  var CATEGORY_INFO = {
    ROTATION: { label: 'Rotation day', visible: false },
    CLOSED: { label: 'No school', visible: true },
    NO_ASSESSMENTS: { label: 'No assessments', visible: true },
    EXAM_WINDOW: { label: 'Exam window', visible: true },
    TESTING: { label: 'External testing', visible: true },
    CAUTION: { label: 'Students may be out of class', visible: true },
    EVENT: { label: 'Event', visible: true },
    DEADLINE: { label: 'Staff deadline', visible: true, staffOnly: true },
    HIDDEN: { label: 'Hidden', visible: false }
  };

  /** [pattern, category, note]. Seeded into the CalendarRules tab by Set up. */
  var DEFAULT_RULES = [
    ['^MS\\s*/\\s*HS\\s+Day\\s+\\d+$', 'ROTATION', 'Secondary rotation day (Day 1–10).'],
    ['^Elem(\\.|entary)?\\s+Day\\s+[A-Z]$', 'HIDDEN', 'Elementary rotation day.'],
    ['NO STUDENTS|Mid[\\s-]*Term Break|Winter Break|Spring Break|Summer Break|\\bEid\\b|Public Holiday|School Closed|\\bHoliday\\b',
      'CLOSED', 'No school. On a day that still has a rotation day this becomes NO_ASSESSMENTS.'],
    ['National Day Celebration|Sports Day|Field Day', 'NO_ASSESSMENTS', 'Whole-day events with no normal lessons.'],
    ['Semester\\s*\\d*\\s*Exams?|Final Exams?|Mock Exams?|IB Mocks?|Exam Week', 'EXAM_WINDOW', 'Only exams may be booked.'],
    ['\\bMAP\\b|CAT\\s?4|PIRLS|TIMSS|PISA|\\bABT\\b|Arabic Benchmark|\\bP?SAT\\b|\\bAP Exams?|\\bIB\\s+(DP\\s+)?Exams?|EmSAT|NWEA',
      'TESTING', 'External testing: teachers see a warning.'],
    ['Parent[\\s-]*Teacher Conf|\\bPTC\\b|Career (Exploration|Fair)|Field\\s*trip|University Fair|\\bMUN\\b|Dress Rehearsal',
      'CAUTION', 'Students may be out of class: teachers see a warning.'],
    ['Grades? (DUE|LIVE)|Progress Reports?|Report Cards?|Comments due', 'DEADLINE', 'Shown to staff only.'],
    ['Building Meeting|GLL Meeting|Staff Meeting|Faculty Meeting|\\bPLC\\b|\\bASA|Registration|Appreciation|^TRIMESTER\\b|^SEMESTER\\s*\\d',
      'HIDDEN', 'Staff logistics and term markers.']
  ];

  var AFTER_SCHOOL = 15 * 60;      // timed events starting 15:00 or later are hidden
  var K5 = ['K', '1', '2', '3', '4', '5'];

  var model = null;

  /* ------------------------------------------------------------------
     Classification
     ------------------------------------------------------------------ */

  function safeRegex(p) {
    try { return p ? new RegExp(p, 'i') : null; } catch (e) { return null; }
  }

  function rules() {
    var rows = Store.all('CalendarRules');
    var list = rows.length
      ? rows.map(function (r) { return [r.pattern, r.category]; })
      : DEFAULT_RULES;
    return list.map(function (r) {
      var re = safeRegex(U.clean(r[0]));
      var cat = U.clean(r[1]).toUpperCase();
      return re && CATEGORY_INFO[cat] ? { re: re, category: cat } : null;
    }).filter(Boolean);
  }

  function between(a, b) {
    var out = [];
    for (var g = a; g <= b; g++) out.push(String(g));
    return out;
  }

  /**
   * Grades named in free text, or null when the text names none (= everyone).
   * Explicit grade numbers win over division words: "Secondary Career Fair
   * G6-G9" is Grades 6–9, not the whole of Secondary.
   */
  function parseGrades(text) {
    var t = ' ' + U.clean(text) + ' ';
    var explicit = {};
    var broad = {};
    function add(set, list) { list.forEach(function (g) { set[g] = true; }); }
    var m;
    var range = /\b(?:G|Gr\.?|Grades?)\s*(\d{1,2})\s*(?:-|–|—|to|&|and)\s*(?:G|Gr\.?|Grades?)?\s*(\d{1,2})\b/gi;
    while ((m = range.exec(t))) {
      if (+m[1] <= +m[2] && +m[2] <= 12) add(explicit, between(+m[1], +m[2]));
    }
    var single = /\b(?:G|Gr\.?|Grades?)\s*(\d{1,2})\b/gi;
    while ((m = single.exec(t))) {
      if (+m[1] <= 12) add(explicit, [String(+m[1])]);
    }
    if (/\bMS\s*(?:\/|&|and)\s*HS\b|\bSecondary\b/i.test(t)) add(broad, between(6, 12));
    if (/\bMS\b|Middle School/i.test(t)) add(broad, between(6, 8));
    if (/\bHS\b|High School/i.test(t)) add(broad, between(9, 12));
    if (/\bSeniors?\b/i.test(t)) add(broad, ['12']);
    if (/\bJuniors?\b/i.test(t)) add(broad, ['11']);
    if (/Elementary|\bElem\b|\bELM\b|Kindergarten|\bKG\d?\b|\bPre-?K\b/i.test(t)) add(broad, K5);
    var set = Object.keys(explicit).length ? explicit : broad;
    var list = Object.keys(set);
    return list.length ? U.sortGrades(list) : null;
  }

  /** { category, grades } for one plain calendar event (see Svc.gs). */
  function classify(ev, ruleList) {
    var title = U.clean(ev.title);
    if (!ev.allDay && ev.startTime && U.minutes(ev.startTime) >= AFTER_SCHOOL) {
      return { category: 'HIDDEN', grades: null };
    }
    var category = 'EVENT';
    for (var i = 0; i < ruleList.length; i++) {
      if (ruleList[i].re.test(title)) {
        category = ruleList[i].category;
        break;
      }
    }
    var grades = parseGrades(title) || parseGrades(U.stripHtml(ev.description).slice(0, 400));
    return { category: category, grades: grades };
  }

  /* ------------------------------------------------------------------
     Sync
     ------------------------------------------------------------------ */

  function calendarId() {
    var s = Config.get();
    return s.internalCalendarId || Svc.calendarIdByName(s.internalCalendarName);
  }

  /** Copies the Internal Calendar into InternalEvents, keeping admin overrides. */
  function sync() {
    var s = Config.get();
    var calId = calendarId();
    if (!calId) {
      throw U.err('CONFIG', 'Cannot find the Internal Calendar. Put its Calendar ID in Settings, internal_calendar_id.');
    }
    var list = Svc.calendarEvents(calId, s.yearStart, U.addDays(s.yearEnd, 1));
    var ruleList = rules();
    var prev = {};
    Store.all('InternalEvents').forEach(function (r) {
      prev[U.clean(r.event_id) + '|' + U.normDate(r.start)] = r;
    });
    var stamp = Svc.stamp();
    var rows = list.map(function (ev) {
      var c = classify(ev, ruleList);
      var end = ev.allDay ? U.addDays(ev.endDate, -1) : (ev.endDate || ev.startDate);
      if (!ev.allDay && ev.endTime === '00:00' && end > ev.startDate) end = U.addDays(end, -1);
      if (end < ev.startDate) end = ev.startDate;
      var p = prev[ev.id + '|' + ev.startDate] || {};
      return {
        event_id: ev.id, start: ev.startDate, end: end, all_day: !!ev.allDay,
        start_time: ev.startTime || '', end_time: ev.endTime || '', title: U.clean(ev.title),
        category: c.category, grades: c.grades ? c.grades.join(',') : 'ALL',
        override_category: U.clean(p.override_category), override_grades: U.clean(p.override_grades),
        synced_at: stamp
      };
    });
    rows.sort(function (a, b) {
      if (a.start !== b.start) return a.start < b.start ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });
    Svc.withLock(function () { Store.replaceAll('InternalEvents', rows); });
    model = null;
    return { events: rows.length, calendarId: calId, syncedAt: stamp };
  }

  /* ------------------------------------------------------------------
     Bell schedules
     ------------------------------------------------------------------ */

  var DOW = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

  /** 'MON-THU' → [1,2,3,4]; 'FRI' → [5]; 'MON,WED' → [1,3]; '1-4' → [1,2,3,4]. */
  function parseWeekdays(text) {
    var out = [];
    U.clean(text).toUpperCase().split(/[,;\s]+/).forEach(function (part) {
      if (!part) return;
      var ends = part.split('-');
      var a = DOW[ends[0].slice(0, 3)] || +ends[0];
      var b = ends.length > 1 ? (DOW[ends[1].slice(0, 3)] || +ends[1]) : a;
      for (var d = a; d && d <= b && d <= 7; d++) out.push(d);
    });
    return U.uniq(out);
  }

  function bellModel() {
    var rows = Store.all('Bells');
    if (!rows.length) {
      rows = Config.DEFAULT_BELLS.map(function (b) {
        return { schedule: b[0], from: b[1], to: b[2], weekdays: b[3], period: b[4], start: b[5], end: b[6] };
      });
    }
    var groups = {};
    rows.forEach(function (r) {
      var wd = parseWeekdays(r.weekdays);
      var p = U.clean(r.period);
      var st = U.normTime(r.start, true);
      var en = U.normTime(r.end, true);
      if (!wd.length || !p || !st || !en) return;
      var from = U.normDate(r.from);
      var to = U.normDate(r.to);
      var name = U.clean(r.schedule) || 'Regular';
      var key = [name, from, to, wd.join('')].join('|');
      var g = groups[key] || (groups[key] = { name: name, from: from, to: to, weekdays: wd, periods: [] });
      g.periods.push({ p: p, start: st, end: en });
    });
    var sets = {};
    var list = Object.keys(groups).map(function (k, i) {
      var g = groups[k];
      g.id = 'b' + i;
      g.periods.sort(function (a, b) { return U.minutes(a.start) - U.minutes(b.start); });
      sets[g.id] = g.periods;
      return g;
    });
    var byDate = {};
    function idFor(date) {
      if (byDate[date] !== undefined) return byDate[date];
      var dow = U.isoDow(date);
      var best = null;
      var bestSpan = Infinity;
      list.forEach(function (g) {
        if (g.weekdays.indexOf(dow) < 0) return;
        if (g.from && date < g.from) return;
        if (g.to && date > g.to) return;
        var span = g.from && g.to ? U.daysBetween(g.from, g.to) : (g.from || g.to ? 1e6 : 1e7);
        if (span < bestSpan) {
          best = g.id;
          bestSpan = span;
        }
      });
      byDate[date] = best;
      return best;
    }
    return {
      sets: sets,
      idFor: idFor,
      periodsFor: function (date) { var id = idFor(date); return id ? sets[id] : []; }
    };
  }

  /* ------------------------------------------------------------------
     The day model
     ------------------------------------------------------------------ */

  function rotationNumber(title, pattern) {
    var re = safeRegex(pattern);
    var m = re && title.match(re);
    if (m && m[1]) return +m[1];
    m = title.match(/(\d+)\s*$/);
    return m ? +m[1] : null;
  }

  function data() {
    if (model) return model;
    var s = Config.get();
    var bells = bellModel();
    var rotation = {};
    var events = [];

    Store.all('InternalEvents').forEach(function (r) {
      var cat = (U.clean(r.override_category) || U.clean(r.category)).toUpperCase();
      var start = U.normDate(r.start);
      if (!start || !CATEGORY_INFO[cat]) return;
      var end = U.normDate(r.end) || start;
      var title = U.clean(r.title);
      if (cat === 'ROTATION') {
        var n = rotationNumber(title, s.rotationPattern);
        if (n) rotation[start] = n;
        return;
      }
      if (!CATEGORY_INFO[cat].visible) return;
      var gtext = U.clean(r.override_grades) || U.clean(r.grades);
      var grades = !gtext || /^ALL$/i.test(gtext) ? null : U.splitList(gtext).map(U.normGrade);
      if (grades) {
        grades = grades.filter(function (g) { return s.grades.indexOf(g) >= 0; });
        if (!grades.length) return;                // not for this division
        if (grades.length === s.grades.length) grades = null;
      }
      var allDay = U.bool(r.all_day);
      var ev = {
        id: U.clean(r.event_id) + '|' + start, title: title, category: cat, start: start, end: end,
        allDay: allDay || start !== end,
        startTime: allDay ? '' : U.normTime(r.start_time), endTime: allDay ? '' : U.normTime(r.end_time),
        grades: grades, periods: []
      };
      if (!ev.allDay && ev.startTime && ev.endTime) {
        var a = U.minutes(ev.startTime);
        var b = U.minutes(ev.endTime);
        ev.periods = bells.periodsFor(start).filter(function (p) {
          return U.minutes(p.start) < b && a < U.minutes(p.end);
        }).map(function (p) { return p.p; });
      }
      events.push(ev);
    });

    var rotDates = Object.keys(rotation).sort();
    var first = rotDates[0] || null;
    var last = rotDates[rotDates.length - 1] || null;

    var days = {};
    U.range(s.yearStart, s.yearEnd).forEach(function (d) {
      if (U.isoDow(d) > 5) return;
      days[d] = { date: d, rotation: rotation[d] || null, status: 'SCHOOL', label: '', events: [], bell: bells.idFor(d) };
    });
    events.slice().forEach(function (ev, idx) {
      U.range(ev.start, ev.end).forEach(function (d) { if (days[d]) days[d].events.push(idx); });
    });

    Object.keys(days).forEach(function (d) {
      var day = days[d];
      var closers = day.events.filter(function (i) { return events[i].category === 'CLOSED'; });
      if (closers.length) {
        var whole = closers.filter(function (i) { return !events[i].grades; });
        if (whole.length && !day.rotation) {
          day.status = 'CLOSED';
          day.label = events[whole[0]].title;
        } else {
          // Students are in school after all (a rotation day exists), or only some
          // grades are off: the closure means "no assessments" for that day.
          day.events = day.events.map(function (i) {
            if (events[i].category !== 'CLOSED') return i;
            var copy = {};
            Object.keys(events[i]).forEach(function (k) { copy[k] = events[i][k]; });
            copy.id = events[i].id + '@' + d;
            copy.category = 'NO_ASSESSMENTS';
            copy.start = d;
            copy.end = d;
            events.push(copy);
            return events.length - 1;
          });
        }
      }
      if (day.status === 'SCHOOL' && !day.rotation && first && d > first && d < last) {
        day.status = 'UNLISTED';
      }
    });

    model = { days: days, events: events, bells: bells, firstRotation: first, lastRotation: last };
    return model;
  }

  /** The day record for a date, including weekends and dates outside the year. */
  function day(date) {
    var m = data();
    if (m.days[date]) return m.days[date];
    var s = Config.get();
    var status = U.isoDow(date) > 5 ? 'WEEKEND' : 'OUTSIDE';
    if (status === 'WEEKEND' && (date < s.yearStart || date > s.yearEnd)) status = 'OUTSIDE';
    return { date: date, rotation: null, status: status, label: '', events: [], bell: null };
  }

  /** Events on a date that concern at least one of the given grades. */
  function eventsFor(date, grades) {
    var m = data();
    return day(date).events.map(function (i) { return m.events[i]; }).filter(function (ev) {
      return !ev.grades || !grades || grades.some(function (g) { return ev.grades.indexOf(g) >= 0; });
    });
  }

  function periodsFor(date) { return data().bells.periodsFor(date); }

  function lastSynced() {
    var rows = Store.all('InternalEvents');
    return rows.length ? U.clean(rows[0].synced_at) : '';
  }

  /** Compact form for the browser. Students never receive staff-only events. */
  function forClient(isStaff) {
    var m = data();
    var keep = [];
    var map = {};
    m.events.forEach(function (ev, i) {
      if (!isStaff && CATEGORY_INFO[ev.category].staffOnly) return;
      map[i] = keep.length;
      keep.push({
        id: ev.id, title: ev.title, category: ev.category, start: ev.start, end: ev.end,
        allDay: ev.allDay, startTime: ev.startTime, endTime: ev.endTime,
        grades: ev.grades, periods: ev.periods
      });
    });
    var days = {};
    Object.keys(m.days).forEach(function (d) {
      var x = m.days[d];
      days[d] = {
        r: x.rotation, s: x.status, l: x.label, b: x.bell,
        e: x.events.filter(function (i) { return map[i] !== undefined; }).map(function (i) { return map[i]; })
      };
    });
    var cats = {};
    Object.keys(CATEGORY_INFO).forEach(function (k) { cats[k] = CATEGORY_INFO[k].label; });
    return {
      days: days, events: keep, bells: m.bells.sets, categories: cats,
      firstRotation: m.firstRotation, lastRotation: m.lastRotation, syncedAt: lastSynced()
    };
  }

  function reset() { model = null; }

  return {
    CATEGORY_INFO: CATEGORY_INFO, DEFAULT_RULES: DEFAULT_RULES, parseGrades: parseGrades,
    classify: classify, rules: rules, sync: sync, calendarId: calendarId,
    parseWeekdays: parseWeekdays, data: data, day: day, eventsFor: eventsFor,
    periodsFor: periodsFor, forClient: forClient, reset: reset
  };
})();
