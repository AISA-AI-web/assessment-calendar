/**
 * Mirror.gs: one-way copies of entries on the grade assessment calendars, and
 * the one-time import of what teachers had already put on those calendars.
 *
 * The app is the source of truth. Each ACTIVE entry gets one event on the
 * calendar of every grade it touches; the event ids are kept in the entry's
 * `mirror` column as { grade: { id, cal } }. Editing an entry updates its
 * events; cancelling it, or a request being declined, deletes them. Changes
 * made directly on a mirrored event are overwritten the next time it syncs.
 *
 * Import: every event on the grade calendars becomes an entry straight away
 * (menu step 4, then hourly). The app matches it to classes by its course
 * code, Girls/Boys, subject, period and who posted it. A summative matched to
 * classes counts toward the daily limit; anything else is shown but not
 * counted. Each event is logged in the ImportQueue tab. Its entries follow the
 * event (moved, renamed, deleted) and are not copied back, until someone edits
 * one in the app: the app then takes the event over like any other copy.
 */
var Mirror = (function () {
  'use strict';

  function isSlt(u) { return u.role === 'SLT' || u.role === 'ADMIN'; }

  function wanted(e) {
    var s = Config.get();
    if (e.status !== 'ACTIVE') return false;
    return e.announced || s.mirrorUnannounced;
  }

  /** The calendar event for an entry on one grade's calendar. */
  function spec(e) {
    var s = Config.get();
    var sec = e.section_id ? Dir.section(e.section_id) : null;
    var cat = Config.category(e.category);
    var catLabel = cat ? cat.label : e.category;
    var what = sec ? Dir.label(sec) : 'Grade ' + e.grade;
    var periods = Days.periodsFor(e.date).filter(function (p) { return e.periods.indexOf(p.p) >= 0; });
    var timed = periods.length > 0;
    var day = Days.day(e.date);
    var lines = [
      e.title,
      catLabel + (e.format ? ' · ' + e.format : ''),
      'Class: ' + what,
      'Teacher: ' + Dir.teacherName(e.teacher_email) + (e.teacher_email ? ' <' + e.teacher_email + '>' : ''),
      'When: ' + U.human(e.date) + (day.rotation ? ' · Day ' + day.rotation : '') +
        (timed ? ' · P' + e.periods.join(', P') : ' · all day'),
      'Announced to students: ' + (e.announced ? 'yes' : 'not yet')
    ];
    if (e.notes) lines.push('', e.notes);
    lines.push('', 'Managed by the Assessment Calendar. Change it there: edits made here are overwritten.');
    var url = s.appUrl || Svc.appUrl();
    if (url) lines.push(url);
    return {
      title: catLabel + ': ' + what + ' – ' + e.title,
      description: lines.join('\n'),
      date: e.date,
      allDay: !timed,
      start: timed ? periods[0].start : '',
      end: timed ? periods[periods.length - 1].end : ''
    };
  }

  /** Brings an entry's calendar copies in line with the entry. Returns { mirror, status }. */
  function sync(e) {
    var s = Config.get();
    var current = e.mirror || {};
    // Still following its own event on the grade calendar: nothing to copy.
    if (e.mirror_status === 'SOURCE') return { mirror: current, status: 'SOURCE' };
    if (!s.mirrorEnabled) return { mirror: current, status: e.mirror_status || '' };
    var mirror = {};
    Object.keys(current).forEach(function (g) { mirror[g] = current[g]; });
    var want = wanted(e) ? Rules.gradesOf(e).filter(function (g) { return s.gradeCalendars[g]; }) : [];
    var errors = [];

    Object.keys(mirror).forEach(function (g) {
      if (want.indexOf(g) >= 0) return;
      var m = mirror[g] || {};
      try {
        if (m.id) Svc.calendarDelete(m.cal || s.gradeCalendars[g], m.id);
        delete mirror[g];
      } catch (x) {
        errors.push('Grade ' + g + ': ' + x.message);
      }
    });

    want.forEach(function (g) {
      var cal = s.gradeCalendars[g];
      var m = mirror[g] || {};
      try {
        if (m.id && m.cal && m.cal !== cal) {
          try { Svc.calendarDelete(m.cal, m.id); } catch (ignored) { /* the old calendar may be gone */ }
          m = {};
        }
        mirror[g] = { id: Svc.calendarUpsert(cal, m.id || '', spec(e)), cal: cal };
      } catch (x) {
        errors.push('Grade ' + g + ': ' + x.message);
      }
    });

    return {
      mirror: mirror,
      status: errors.length ? ('ERROR ' + errors.join('; ')).slice(0, 300) : (want.length ? 'OK' : '')
    };
  }

  function needsWork(e) {
    var s = Config.get();
    if (!s.mirrorEnabled || e.mirror_status === 'SOURCE') return false;
    if (/^ERROR/.test(e.mirror_status)) return true;
    if (e.status === 'CANCELLED' && !Object.keys(e.mirror).length) return false;
    var want = wanted(e) ? Rules.gradesOf(e).filter(function (g) { return s.gradeCalendars[g]; }) : [];
    var have = Object.keys(e.mirror);
    return want.length !== have.length || want.some(function (g) { return have.indexOf(g) < 0; });
  }

  /** Hourly: retries failed copies and fills gaps (e.g. a calendar ID added later). */
  function retryFailed(limit) {
    var started = Date.now();
    var done = 0;
    Entries.reload();
    Entries.all().filter(needsWork).some(function (e) {
      Entries.syncMirror(e);
      done++;
      return done >= (limit || 60) || Date.now() - started > 240000;
    });
    return { synced: done };
  }

  /** Admin menu: rewrites every copy, e.g. after the event format changed. */
  function resyncAll() {
    var started = Date.now();
    var done = 0;
    var left = 0;
    Entries.reload();
    Entries.all().forEach(function (e) {
      if (e.status === 'CANCELLED' && !Object.keys(e.mirror).length) return;
      if (Date.now() - started > 270000) {
        left++;
        return;
      }
      Entries.syncMirror(e);
      done++;
    });
    return { synced: done, remaining: left };
  }

  /* ------------------------------------------------------------------
     Import from the old grade calendars
     ------------------------------------------------------------------ */

  function guessCategory(title) {
    var t = U.clean(title);
    // "SA"/"FA" as in "SA_G11 Chem. Girls_215", but not inside "USA" or "FAQ".
    if (/summ?ativ|\bsumm?s?\b/i.test(t) || /(^|[^A-Za-z])SA(?![A-Za-z])/.test(t)) return 'SUMMATIVE';
    if (/formativ|\bfrm\b/i.test(t) || /(^|[^A-Za-z])FA(?![A-Za-z])/.test(t)) return 'FORMATIVE';
    if (/\bexam\b|\bmock\b|\bpaper\s*\d/i.test(t)) return 'SUMMATIVE';
    return '';
  }

  var MANAGED = /Managed by the Assessment Calendar/;

  /** Each grade calendar's events from a date to the end of the year, read once. A calendar that can't be read is left out. */
  function gradeEvents(from) {
    var s = Config.get();
    var out = {};
    s.grades.forEach(function (g) {
      var cal = s.gradeCalendars[g];
      if (!cal) return;
      try {
        var list = Svc.calendarEvents(cal, from, U.addDays(s.yearEnd, 1), true);
        var byId = {};
        list.forEach(function (ev) { if (!byId[ev.id]) byId[ev.id] = ev; });
        out[g] = { list: list, byId: byId };
      } catch (x) {
        Svc.log('Could not read the Grade ' + g + ' calendar: ' + x.message);
      }
    });
    return out;
  }

  function eventFields(ev) {
    return {
      title: U.clean(ev.title), date: ev.startDate, end_date: ev.allDay ? U.addDays(ev.endDate, -1) : ev.startDate,
      start_time: ev.startTime || '', end_time: ev.endTime || '', all_day: !!ev.allDay
    };
  }

  /** Logs events the app has not seen yet as OPEN rows in the ImportQueue tab. */
  function queueNew(byGrade) {
    var known = {};
    Entries.all().forEach(function (e) {
      Object.keys(e.mirror).forEach(function (g) { if (e.mirror[g] && e.mirror[g].id) known[e.mirror[g].id] = true; });
    });
    Store.all('ImportQueue').forEach(function (r) { known[U.clean(r.event_id)] = true; });
    var rows = [];
    Object.keys(byGrade).forEach(function (g) {
      byGrade[g].list.forEach(function (ev) {
        if (known[ev.id] || MANAGED.test(ev.description || '')) return;
        known[ev.id] = true;
        var f = eventFields(ev);
        rows.push({
          import_id: U.uid('I'), grade: g, event_id: ev.id, title: f.title, date: f.date, end_date: f.end_date,
          start_time: f.start_time, end_time: f.end_time, all_day: f.all_day,
          creator_email: U.normEmail((ev.creators || [])[0] || ''), guess_category: guessCategory(ev.title),
          status: 'OPEN', assessment_ids: '', handled_by: '', handled_at: ''
        });
      });
    });
    if (rows.length) Store.append('ImportQueue', rows);
    return rows.length;
  }

  /* ---------- which classes an old event is for ---------- */

  // Built without U: Apps Script loads files alphabetically, so Util.gs is not there yet.
  var NOT_SUBJECTS = {};
  ('summative formative assessment assessments grade girls boys unit test tests quiz exam part paper reading writing ' +
    'window deadline submit showcase final term week day period room the and for with').split(' ')
    .forEach(function (w) { NOT_SUBJECTS[w] = true; });

  /** Lower-case words of three or more letters that could name a subject. */
  function subjectWords(text) {
    return U.uniq(String(text || '').toLowerCase().split(/[^a-z]+/).filter(function (w) {
      return w.length >= 3 && !NOT_SUBJECTS[w];
    }));
  }

  /** How many of a title's words start a word of the course name, or the other way round ("Chem", "Chemistry"). */
  function subjectScore(words, courseName) {
    var cw = subjectWords(courseName);
    return words.filter(function (w) {
      return cw.some(function (c) { return c.indexOf(w) === 0 || w.indexOf(c) === 0; });
    }).length;
  }

  /** How a title may write a course number: B06ASA as B06ASA, B6ASA, 06ASA or 6ASA. */
  function codeForms(course) {
    var c = U.clean(course).toUpperCase().replace(/[^A-Z0-9]/g, '');
    var forms = [c];
    var m = c.match(/^([A-Z]*?)(\d+)([A-Z].*)$/);
    if (m) forms.push(m[1] + String(+m[2]) + m[3], m[2] + m[3], String(+m[2]) + m[3]);
    return U.uniq(forms).filter(function (f) { return f.length >= 4; });
  }

  /** 'G' or 'B' for AISA's girls' and boys' courses (G07ISA, EB2BUS), otherwise ''. */
  function courseGender(course) {
    var m = U.clean(course).toUpperCase().match(/^E?([BG])(?=[A-Z0-9])/);
    return m ? m[1] : '';
  }

  /** Periods an event covers on its date: from its times, otherwise a "P4" in its title. */
  function eventPeriods(row) {
    var date = U.normDate(row.date);
    if (!date) return [];
    var bells = Days.periodsFor(date);
    var st = U.normTime(row.start_time);
    var en = U.normTime(row.end_time);
    if (st && en && !U.bool(row.all_day)) {
      return bells.filter(function (p) {
        return U.minutes(p.start) < U.minutes(en) && U.minutes(st) < U.minutes(p.end);
      }).map(function (p) { return p.p; });
    }
    var m = U.clean(row.title).match(/(^|[^A-Za-z0-9])P(\d{1,2})(?![0-9])/);
    var p = m ? String(+m[2]) : '';
    return p && bells.some(function (b) { return b.p === p; }) ? [p] : [];
  }

  function keepIfAny(list, keep) {
    var next = list.filter(keep);
    return next.length ? next : list;
  }

  /**
   * Every class in the event's grade, narrowed by the course code in its title,
   * Girls/Boys, its subject words and the period it falls in, each step only if
   * something is left. `anchored`: a course code or a subject pinned it down;
   * `both`: the title says it is for girls and boys ("G&B").
   */
  function narrowClasses(row) {
    var d = Dir.load();
    var g = U.normGrade(row.grade);
    var title = U.clean(row.title);
    var list = Object.keys(d.sections).map(function (id) { return d.sections[id]; })
      .filter(function (sec) { return !sec.retired && sec.grades.indexOf(g) >= 0; });
    var anchored = false;
    var both = /(^|[^A-Za-z])(G\s*&\s*B|B\s*&\s*G)(?![A-Za-z])/i.test(title);

    // The longest course-code spelling found wins, so "B7ASA" means B07ASA and not G07ASA.
    // "G&B12 AFL" is for girls and boys alike, so it is compared as "12AFL".
    var compact = (both ? title.replace(/(^|[^A-Za-z])(G\s*&\s*B|B\s*&\s*G)(?![A-Za-z])/gi, '$1') : title)
      .toUpperCase().replace(/[^A-Z0-9]/g, '');
    var best = 0;
    var found = list.map(function (sec) {
      var n = 0;
      codeForms(sec.courseNumber).forEach(function (f) { if (f.length > n && compact.indexOf(f) >= 0) n = f.length; });
      if (n > best) best = n;
      return n;
    });
    if (best) {
      list = list.filter(function (sec, i) { return found[i] === best; });
      anchored = true;
    }

    // Letters around the word, not \b: in "Chem. Girls_215" the underscore counts as a word character.
    var girls = /(^|[^A-Za-z])girls?(?![A-Za-z])/i.test(title);
    var boys = /(^|[^A-Za-z])boys?(?![A-Za-z])/i.test(title);
    both = both || (girls && boys);
    if (girls !== boys) list = keepIfAny(list, function (sec) { return courseGender(sec.courseNumber) === (girls ? 'G' : 'B'); });

    var words = subjectWords(title);
    var scores = list.map(function (sec) { return subjectScore(words, sec.courseName); });
    var top = Math.max.apply(null, [0].concat(scores));
    if (top) {
      list = list.filter(function (sec, i) { return scores[i] === top; });
      anchored = true;
    }

    var periods = eventPeriods(row);
    var dm = title.match(/(^|[^A-Za-z0-9])D(\d{1,2})(?![0-9])/);
    var day = dm ? +dm[2] : +Days.day(U.normDate(row.date)).rotation;
    if (periods.length && day) {
      list = keepIfAny(list, function (sec) {
        return sec.meetings.some(function (m) { return +m.day === day && periods.indexOf(m.period) >= 0; });
      });
    }
    return { list: list, anchored: anchored, both: both };
  }

  /** Why an event is shown as a notice for its grade rather than an assessment, or ''. */
  function noticeReason(row) {
    var date = U.normDate(row.date);
    var end = U.normDate(row.end_date) || date;
    if (date && U.daysBetween(date, end) >= 7) return 'LONG';
    return Config.category(U.clean(row.guess_category).toUpperCase()) ? '' : 'TYPE';
  }

  /**
   * The classes each event is for. Events posted for the same day and the same
   * set of classes, one per class (as "…Girls_113" and "…Girls_215"), get one
   * class each. Otherwise an event gets the poster's own classes among them,
   * unless its title says girls and boys; failing that, all of them if a course
   * code or subject pinned them down; otherwise none. Notices (no assessment
   * word, or longer than a week) get none.
   */
  function planClasses(rows) {
    var items = rows.map(function (row) {
      var notice = noticeReason(row);
      var n = notice ? { list: [], anchored: false, both: false } : narrowClasses(row);
      var creator = U.normEmail(row.creator_email);
      return {
        row: row, notice: notice, list: n.list, anchored: n.anchored, both: n.both, creator: creator, classes: [],
        own: n.list.filter(function (sec) { return sec.teachers.indexOf(creator) >= 0; })
      };
    });
    var groups = {};
    items.filter(function (it) { return !it.notice; }).forEach(function (it) {
      var key = U.normDate(it.row.date) + '|' + U.normGrade(it.row.grade) + '|' + it.list.map(function (s) { return s.id; }).sort().join(',');
      (groups[key] = groups[key] || []).push(it);
    });
    Object.keys(groups).forEach(function (key) {
      var group = groups[key];
      var pinned = group.every(function (it) { return it.anchored || it.own.length; });
      if (group.length > 1 && pinned && group[0].list.length >= group.length) {
        var pool = group[0].list.slice();
        group.slice().sort(function (a, b) { return a.row.title < b.row.title ? -1 : a.row.title > b.row.title ? 1 : 0; })
          .forEach(function (it) {
            var pick = pool.filter(function (sec) { return sec.teachers.indexOf(it.creator) >= 0; })[0] || pool[0];
            pool.splice(pool.indexOf(pick), 1);
            it.classes = [pick];
          });
        return;
      }
      group.forEach(function (it) {
        it.classes = it.own.length && !it.both ? it.own : it.anchored ? it.list : it.own;
      });
    });
    return items;
  }

  /* ---------- making the entries ---------- */

  function importNote(r, it) {
    var g = U.normGrade(r.grade);
    var who = r.creator_email ? Dir.teacherName(U.normEmail(r.creator_email)) : '';
    var date = U.normDate(r.date);
    var end = U.normDate(r.end_date);
    var note = 'From the Grade ' + g + ' assessment calendar' + (who ? ', posted by ' + who : '') + '.';
    if (end && end > date) note += ' It runs to ' + U.human(end) + '.';
    if (it.notice === 'LONG') note += ' It lasts more than a week, so it is shown as a notice for the grade and does not count toward the daily limit.';
    else if (it.notice === 'TYPE') note += ' Its title does not say it is an assessment, so it is shown as a notice for the grade and does not count toward the daily limit.';
    else if (!it.classes.length) note += ' The app could not tell which class it is for, so it does not count toward the daily limit.';
    return note;
  }

  /** Turns every OPEN row of the ImportQueue tab into entries. Run inside the lock. */
  function importOpen() {
    var res = { events: 0, counted: 0, unmatched: 0, perGrade: {} };
    var open = Store.all('ImportQueue').filter(function (r) { return U.clean(r.status) === 'OPEN' && U.normDate(r.date); });
    if (!open.length) return res;
    var now = Svc.stamp();
    var rows = [];
    planClasses(open).forEach(function (it) {
      var r = it.row;
      var g = U.normGrade(r.grade);
      var guess = U.clean(r.guess_category).toUpperCase();
      var category = !it.notice && Config.category(guess) ? guess : 'FORMATIVE';
      var creator = it.creator;
      var gid = U.uid('G');
      var made = (it.classes.length ? it.classes : [null]).map(function (sec) {
        return {
          id: U.uid('A'), group_id: gid, status: 'ACTIVE', category: category, format: '',
          title: (U.clean(r.title) || 'Assessment').slice(0, 120), notes: importNote(r, it),
          section_id: sec ? sec.id : '', grade: sec ? '' : g, date: U.normDate(r.date), periods: eventPeriods(r).join(','),
          announced: false,
          teacher_email: !sec || !sec.teachers.length || sec.teachers.indexOf(creator) >= 0 ? creator : sec.teachers[0],
          created_by: creator, created_at: now, updated_by: creator, updated_at: now,
          request_reason: '', override_reason: '', override_by: '', decided_by: '', decided_at: '', decision_note: '',
          mirror: '', mirror_status: 'SOURCE', source: 'CALENDAR', source_ref: U.clean(r.import_id)
        };
      });
      rows = rows.concat(made);
      r.status = 'IMPORTED';
      r.assessment_ids = made.map(function (x) { return x.id; }).join(',');
      r.handled_by = 'import';
      r.handled_at = now;
      Store.update('ImportQueue', r);
      res.events++;
      res.perGrade[g] = (res.perGrade[g] || 0) + 1;
      if (!it.classes.length) res.unmatched++;
      else if (Config.isCounted(category)) res.counted++;
    });
    Store.append('Assessments', rows);
    Entries.reload();
    return res;
  }

  /** Entries still following their event: they move, are renamed or are cancelled with it. Run inside the lock. */
  function follow(byGrade, from) {
    var res = { moved: 0, removed: 0 };
    var rows = {};
    Store.all('ImportQueue').forEach(function (r) { rows[U.clean(r.import_id)] = r; });
    var groups = {};
    Entries.all().forEach(function (e) {
      if (e.mirror_status !== 'SOURCE' || e.status !== 'ACTIVE' || e.date < from) return;
      (groups[e.source_ref] = groups[e.source_ref] || []).push(e);
    });
    var now = Svc.stamp();
    Object.keys(groups).forEach(function (ref) {
      var r = rows[ref];
      var cal = r && byGrade[U.normGrade(r.grade)];
      if (!cal) return;
      var ev = cal.byId[U.clean(r.event_id)];
      if (ev && MANAGED.test(ev.description || '')) return;
      if (!ev) {
        groups[ref].forEach(function (e) {
          e.status = 'CANCELLED';
          e.updated_by = 'import';
          e.updated_at = now;
          Entries.save(e);
        });
        res.removed++;
        return;
      }
      var f = eventFields(ev);
      if (f.title === U.clean(r.title) && f.date === U.normDate(r.date) && f.end_date === U.normDate(r.end_date) &&
          f.start_time === U.normTime(r.start_time) && f.end_time === U.normTime(r.end_time) && f.all_day === U.bool(r.all_day)) return;
      Object.keys(f).forEach(function (k) { r[k] = f[k]; });
      Store.update('ImportQueue', r);
      var periods = eventPeriods(r);
      groups[ref].forEach(function (e) {
        e.title = (f.title || e.title).slice(0, 120);
        e.date = f.date;
        e.periods = periods;
        e.updated_by = 'import';
        e.updated_at = now;
        Entries.save(e);
      });
      res.moved++;
    });
    return res;
  }

  /** Menu step 4: every event on the grade calendars the app has not seen becomes entries now. */
  function importExisting() {
    var s = Config.get();
    var from = s.importFrom || Svc.today();
    var byGrade = gradeEvents(from);
    return Svc.withLock(function () {
      Store.invalidate('ImportQueue');
      Entries.reload();
      var added = queueNew(byGrade);
      var res = importOpen();
      res.added = added;
      res.from = from;
      return res;
    });
  }

  /** Hourly: new events come in, and entries still following their event catch up with it. */
  function syncImports() {
    var s = Config.get();
    if (!s.grades.some(function (g) { return s.gradeCalendars[g]; })) return null;
    var from = Svc.today();
    var byGrade = gradeEvents(from);
    return Svc.withLock(function () {
      Store.invalidate('ImportQueue');
      Entries.reload();
      var added = queueNew(byGrade);
      var res = importOpen();
      var f = follow(byGrade, from);
      res.added = added;
      res.moved = f.moved;
      res.removed = f.removed;
      return res;
    });
  }

  /** An imported entry was edited in the app: from now on the app keeps its event up to date, as with any copy. */
  function takeOver(e) {
    e.mirror_status = '';
    var r = importRow(U.clean(e.source_ref));
    var g = r ? U.normGrade(r.grade) : '';
    var cal = g ? Config.get().gradeCalendars[g] : '';
    var id = r ? U.clean(r.event_id) : '';
    if (!cal || !id) return;
    var taken = Entries.all().some(function (x) { return x.id !== e.id && x.mirror && x.mirror[g] && x.mirror[g].id === id; });
    if (taken) return;
    e.mirror = {};
    e.mirror[g] = { id: id, cal: cal };
  }

  function importRow(id) {
    var rows = Store.all('ImportQueue');
    for (var i = 0; i < rows.length; i++) if (U.clean(rows[i].import_id) === id) return rows[i];
    return null;
  }

  function mayHandle(r, u) {
    return isSlt(u) || (u.role === 'TEACHER' && U.normEmail(r.creator_email) === u.email);
  }

  /** The import row, if it is still open and this person may handle it. */
  function openImport(id, u) {
    var r = importRow(U.clean(id));
    if (!r) throw U.err('NOT_FOUND', 'That old calendar entry is no longer in the list.');
    if (U.clean(r.status) !== 'OPEN') throw U.err('CONFLICT', 'That old calendar entry has already been handled.');
    if (!mayHandle(r, u)) throw U.err('FORBIDDEN', 'Only the person who created it, or SLT, can bring it in.');
    return r;
  }

  function markImport(r, status, ids, u) {
    r.status = status;
    r.assessment_ids = (ids || []).join(',');
    r.handled_by = u.email;
    r.handled_at = Svc.stamp();
    Store.update('ImportQueue', r);
  }

  /** The old event becomes the copy of the first new entry in its grade; otherwise it is deleted. */
  function adopt(r, entries) {
    var s = Config.get();
    var g = U.normGrade(r.grade);
    var cal = s.gradeCalendars[g];
    var target = null;
    entries.some(function (e) {
      if (wanted(e) && Rules.gradesOf(e).indexOf(g) >= 0 && !(e.mirror && e.mirror[g])) target = e;
      return !!target;
    });
    if (target && cal) {
      target.mirror = target.mirror || {};
      target.mirror[g] = { id: U.clean(r.event_id), cal: cal };
      return;
    }
    if (cal && s.mirrorEnabled) {
      try { Svc.calendarDelete(cal, U.clean(r.event_id)); } catch (x) { Svc.log('Could not delete imported event: ' + x.message); }
    }
  }

  function ignore(req, u) {
    return Svc.withLock(function () {
      Store.invalidate('ImportQueue');
      var r = openImport(req && req.id, u);
      markImport(r, 'IGNORED', [], u);
      return { id: r.import_id };
    });
  }

  /** Open imports for the browser: the person's own, or all of them for SLT. */
  function openImports(u) {
    if (!isSlt(u) && u.role !== 'TEACHER') return [];
    return Store.all('ImportQueue').filter(function (r) {
      return U.clean(r.status) === 'OPEN' && mayHandle(r, u);
    }).map(function (r) {
      var date = U.normDate(r.date);
      var st = U.normTime(r.start_time);
      var en = U.normTime(r.end_time);
      var periods = [];
      if (date && st && en && !U.bool(r.all_day)) {
        periods = Days.periodsFor(date).filter(function (p) {
          return U.minutes(p.start) < U.minutes(en) && U.minutes(st) < U.minutes(p.end);
        }).map(function (p) { return p.p; });
      }
      return {
        id: U.clean(r.import_id), grade: U.normGrade(r.grade), title: U.clean(r.title), date: date,
        endDate: U.normDate(r.end_date) || date, startTime: st, endTime: en, allDay: U.bool(r.all_day),
        creatorEmail: U.normEmail(r.creator_email), creatorName: Dir.teacherName(U.normEmail(r.creator_email)),
        guessCategory: U.clean(r.guess_category), periods: periods
      };
    }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }

  function openImportCount(u) { return openImports(u).length; }

  return {
    spec: spec, sync: sync, wanted: wanted, retryFailed: retryFailed, resyncAll: resyncAll,
    guessCategory: guessCategory, importExisting: importExisting, syncImports: syncImports, takeOver: takeOver,
    planClasses: planClasses, openImport: openImport,
    markImport: markImport, adopt: adopt, ignore: ignore, openImports: openImports,
    openImportCount: openImportCount
  };
})();
