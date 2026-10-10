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
 * Import: existing events become rows in the ImportQueue tab. Their creators
 * see them in the app and either turn each into an entry (the old event is
 * then taken over and retitled in the standard format) or mark it "not an
 * assessment", which leaves it alone.
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
    if (!s.mirrorEnabled) return false;
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
    if (/summ?ativ|\bsumm?s?\b/i.test(t)) return 'SUMMATIVE';
    if (/formativ|\bfrm\b/i.test(t)) return 'FORMATIVE';
    if (/\bexam\b|\bmock\b|\bpaper\s*\d/i.test(t)) return 'SUMMATIVE';
    return '';
  }

  /** Queues every event on the grade calendars that the app does not know yet. */
  function importExisting() {
    var s = Config.get();
    var from = s.importFrom || Svc.today();
    var known = {};
    Entries.all().forEach(function (e) {
      Object.keys(e.mirror).forEach(function (g) { if (e.mirror[g] && e.mirror[g].id) known[e.mirror[g].id] = true; });
    });
    Store.all('ImportQueue').forEach(function (r) { known[U.clean(r.event_id)] = true; });
    var rows = [];
    var perGrade = {};
    s.grades.forEach(function (g) {
      var cal = s.gradeCalendars[g];
      if (!cal) return;
      Svc.calendarEvents(cal, from, U.addDays(s.yearEnd, 1), true).forEach(function (ev) {
        if (known[ev.id] || /Managed by the Assessment Calendar/.test(ev.description || '')) return;
        known[ev.id] = true;
        rows.push({
          import_id: U.uid('I'), grade: g, event_id: ev.id, title: U.clean(ev.title),
          date: ev.startDate, end_date: ev.allDay ? U.addDays(ev.endDate, -1) : ev.startDate,
          start_time: ev.startTime || '', end_time: ev.endTime || '', all_day: !!ev.allDay,
          creator_email: U.normEmail((ev.creators || [])[0] || ''), guess_category: guessCategory(ev.title),
          status: 'OPEN', assessment_ids: '', handled_by: '', handled_at: ''
        });
        perGrade[g] = (perGrade[g] || 0) + 1;
      });
    });
    if (rows.length) Svc.withLock(function () { Store.append('ImportQueue', rows); });
    return { added: rows.length, perGrade: perGrade, from: from };
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
    guessCategory: guessCategory, importExisting: importExisting, openImport: openImport,
    markImport: markImport, adopt: adopt, ignore: ignore, openImports: openImports,
    openImportCount: openImportCount
  };
})();
