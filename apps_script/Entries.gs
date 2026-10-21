/**
 * Entries.gs: assessments. Create, change, delete, approve, and who sees what.
 *
 * One row in the Assessments tab is one class (or one whole grade) on one date.
 * A booking for three classes writes three rows that share a group_id.
 *
 * Statuses:
 *   ACTIVE     counted, mirrored to the grade calendars, visible to students once announced
 *   PENDING    a teacher asked SLT to override a block; visible to staff, not counted
 *   DECLINED   SLT said no; visible to its teacher and SLT, who can move it and resubmit
 *   CANCELLED  deleted; kept for the record, visible to nobody
 *
 * Every write re-reads the tab and re-checks the rules inside the script lock,
 * so two teachers saving at the same moment cannot both take the last slot.
 */
var Entries = (function () {
  'use strict';

  var cache = null;

  function periodSort(a, b) { return (parseInt(a, 10) || 0) - (parseInt(b, 10) || 0) || (a < b ? -1 : a > b ? 1 : 0); }

  function normPeriods(v) { return U.uniq(U.splitList(v).map(function (p) { return String(p).toUpperCase().replace(/^P(?=\d)/, ''); })).sort(periodSort); }

  function norm(r) {
    return {
      _i: r._i,
      id: U.clean(r.id),
      group_id: U.clean(r.group_id),
      status: U.clean(r.status).toUpperCase() || 'ACTIVE',
      category: U.clean(r.category).toUpperCase(),
      format: U.clean(r.format),
      title: U.clean(r.title),
      notes: String(r.notes || '').trim(),
      section_id: U.clean(r.section_id),
      grade: U.clean(r.section_id) ? '' : U.normGrade(r.grade),
      date: U.normDate(r.date),
      periods: normPeriods(r.periods),
      announced: U.bool(r.announced),
      teacher_email: U.normEmail(r.teacher_email),
      created_by: U.normEmail(r.created_by),
      created_at: U.clean(r.created_at),
      updated_by: U.normEmail(r.updated_by),
      updated_at: U.clean(r.updated_at),
      request_reason: U.clean(r.request_reason),
      override_reason: U.clean(r.override_reason),
      override_by: U.clean(r.override_by),
      decided_by: U.normEmail(r.decided_by),
      decided_at: U.clean(r.decided_at),
      decision_note: U.clean(r.decision_note),
      mirror: U.parseJson(r.mirror, {}) || {},
      mirror_status: U.clean(r.mirror_status),
      source: U.clean(r.source) || 'APP',
      source_ref: U.clean(r.source_ref)
    };
  }

  function toRow(e) {
    var o = {};
    Store.SCHEMAS.Assessments.forEach(function (h) { o[h] = e[h]; });
    o.periods = (e.periods || []).join(',');
    o.mirror = e.mirror && Object.keys(e.mirror).length ? JSON.stringify(e.mirror) : '';
    o._i = e._i;
    return o;
  }

  function all() {
    if (!cache) cache = Store.all('Assessments').map(norm).filter(function (e) { return e.id && e.date; });
    return cache;
  }

  function reload() {
    Store.invalidate('Assessments');
    cache = null;
  }

  function byId(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function write(e) {
    Store.update('Assessments', toRow(e));
    cache = null;
  }

  /* ------------------------------------------------------------------
     Permissions and visibility
     ------------------------------------------------------------------ */

  function isSlt(u) { return u.role === 'SLT' || u.role === 'ADMIN'; }

  function canBook(u) { return isSlt(u) || u.role === 'TEACHER'; }

  function owns(e, u) { return !!u.email && (e.teacher_email === u.email || e.created_by === u.email); }

  /** Teachers change their own entries until the day has passed; SLT can change anything. */
  function canEdit(e, u) {
    if (e.status === 'CANCELLED') return false;
    if (isSlt(u)) return true;
    if (u.role !== 'TEACHER' || !owns(e, u)) return false;
    return e.status !== 'ACTIVE' || e.date >= Svc.today();
  }

  function visibleTo(e, u) {
    if (e.status === 'CANCELLED') return false;
    if (u.role === 'STUDENT') {
      if (e.status !== 'ACTIVE' || !e.announced) return false;
      if (e.category === 'FORMATIVE' && !Config.get().showFormativesToStudents) return false;
      if (e.section_id) return Dir.isEnrolled(u.studentId, e.section_id, e.date);
      return e.grade === u.grade;
    }
    if (e.status === 'DECLINED') return isSlt(u) || owns(e, u);
    return true;
  }

  /** The shape the browser gets. Students never see notes, emails or reasons. */
  function project(e, u) {
    var sec = e.section_id ? Dir.section(e.section_id) : null;
    var out = {
      id: e.id, groupId: e.group_id, status: e.status, category: e.category, format: e.format,
      title: e.title, date: e.date, periods: e.periods, announced: e.announced,
      sectionId: e.section_id || null, grade: e.grade || null, grades: Rules.gradesOf(e),
      courseName: sec ? sec.courseName : 'Grade ' + e.grade,
      courseNumber: sec ? sec.courseNumber : '',
      label: sec ? Dir.label(sec) : (e.source === 'CALENDAR' ? 'Grade ' + e.grade + ' (class not known)' : 'All of Grade ' + e.grade),
      department: sec ? sec.department : '',
      teacherName: Dir.teacherName(e.teacher_email)
    };
    if (u.role !== 'STUDENT') {
      out.teacherEmail = e.teacher_email;
      out.notes = e.notes;
      out.createdBy = e.created_by;
      out.createdAt = e.created_at;
      out.updatedBy = e.updated_by;
      out.updatedAt = e.updated_at;
      out.requestReason = e.request_reason;
      out.overrideReason = e.override_reason;
      out.overrideBy = e.override_by;
      out.decisionNote = e.decision_note;
      out.decidedBy = e.decided_by;
      out.mirrorStatus = e.mirror_status;
      out.source = e.source;
      out.mine = owns(e, u);
      out.canEdit = canEdit(e, u);
    }
    return out;
  }

  /* ------------------------------------------------------------------
     Reading
     ------------------------------------------------------------------ */

  function parseScope(key, u) {
    if (u.role === 'STUDENT') return { kind: 'student', key: 'me', studentId: u.studentId, label: 'My assessments' };
    key = U.clean(key);
    var m = key.match(/^grade:(.+)$/);
    if (m) {
      var g = U.normGrade(m[1]);
      if (Config.get().grades.indexOf(g) >= 0) return { kind: 'grade', key: 'grade:' + g, grade: g, label: 'Grade ' + g };
    }
    m = key.match(/^section:(.+)$/);
    if (m) {
      var sec = Dir.section(m[1]);
      if (sec) return { kind: 'section', key: 'section:' + sec.id, sectionId: sec.id, label: Dir.label(sec) };
    }
    return { kind: 'all', key: 'all', label: 'All grades' };
  }

  /** Does an entry concern the scope? For a class: anything any of its students has. */
  function inScope(e, scope, memo) {
    if (scope.kind === 'all' || scope.kind === 'student') return true;
    if (scope.kind === 'grade') return Rules.gradesOf(e).indexOf(scope.grade) >= 0;
    if (e.section_id === scope.sectionId) return true;
    var set = memo[e.date] || (memo[e.date] = U.toSet(Dir.studentsInSection(scope.sectionId, e.date)));
    return Rules.studentsOf(e, e.date).some(function (sid) { return set[sid]; });
  }

  function listRange(req, u) {
    var start = U.normDate(req.start);
    var end = U.normDate(req.end);
    if (!start || !end || end < start) throw U.err('INVALID', 'That date range is not valid.');
    if (U.daysBetween(start, end) > 62) throw U.err('INVALID', 'Ask for at most two months at a time.');
    var scope = parseScope(req.scope, u);
    var visible = all().filter(function (e) { return e.date >= start && e.date <= end && visibleTo(e, u); });
    var memo = {};
    var list = visible.filter(function (e) { return inScope(e, scope, memo); });
    // Students' load counts only what they can see; staff load counts everything.
    var load = Rules.loadFor(scope, start, end, u.role === 'STUDENT' ? visible : all());
    return {
      scope: { key: scope.key, kind: scope.kind, label: scope.label },
      start: start, end: end,
      entries: list.map(function (e) { return project(e, u); }),
      load: load
    };
  }

  function pending(u) {
    if (!isSlt(u)) throw U.err('FORBIDDEN', 'Only SLT can see override requests.');
    return all().filter(function (e) { return e.status === 'PENDING'; })
      .sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; })
      .map(function (e) {
        var ev = Rules.evaluate({
          category: e.category,
          rows: [{ sectionId: e.section_id, grade: e.grade, date: e.date, periods: e.periods }],
          excludeIds: [e.id]
        }, u, { noSuggestions: true });
        var p = project(e, u);
        p.check = ev.rows[0];
        return p;
      });
  }

  function pendingCount() {
    return all().filter(function (e) { return e.status === 'PENDING'; }).length;
  }

  /* ------------------------------------------------------------------
     Writing
     ------------------------------------------------------------------ */

  /** Cleans what the browser sent. Throws INVALID for anything unusable. */
  function sanitize(d, forEvaluate) {
    d = d || {};
    var category = U.clean(d.category).toUpperCase();
    if (!Config.category(category)) throw U.err('INVALID', 'Choose a category.', { field: 'category' });
    var title = U.clean(d.title).slice(0, 120);
    if (!forEvaluate && !title) throw U.err('INVALID', 'Give the assessment a title.', { field: 'title' });
    var seen = {};
    var rows = [];
    (Array.isArray(d.rows) ? d.rows : []).slice(0, 30).forEach(function (r) {
      r = r || {};
      var row = {
        sectionId: U.clean(r.sectionId),
        grade: U.clean(r.sectionId) ? '' : U.normGrade(r.grade),
        date: U.normDate(r.date),
        periods: normPeriods(r.periods)
      };
      var k = (row.sectionId || 'grade:' + row.grade) + '|' + row.date;
      if (seen[k]) return;
      seen[k] = true;
      rows.push(row);
    });
    if (!rows.length) throw U.err('INVALID', 'Choose at least one class.', { field: 'rows' });
    return {
      category: category,
      title: title,
      format: U.clean(d.format).slice(0, 60),
      notes: String(d.notes || '').trim().slice(0, 1000),
      announced: U.bool(d.announced),
      rows: rows,
      excludeIds: [],
      overrideReason: U.clean(d.overrideReason).slice(0, 500),
      requestReason: U.clean(d.requestReason).slice(0, 500),
      importId: U.clean(d.importId)
    };
  }

  /**
   * What a save becomes, given the check. Throws when it cannot be saved:
   *   INVALID         nobody can save it
   *   BLOCKED         a teacher must change it or ask SLT (requestReason)
   *   NEEDS_OVERRIDE  SLT must give a reason to override
   *   NEEDS_REASON    WARN mode: anyone must give a reason
   */
  function decide(ev, d, u, legacy) {
    if (ev.verdict === 'INVALID') {
      var first = null;
      ev.rows.some(function (r) {
        return r.issues.some(function (x) {
          if (x.level === 'INVALID') first = x;
          return !!first;
        });
      });
      throw U.err('INVALID', first ? first.title : 'This booking cannot be saved.', { evaluation: ev });
    }
    if (legacy) {
      return ev.verdict === 'BLOCK'
        ? { status: 'ACTIVE', overrideReason: 'Imported from the old grade calendar', overrideBy: 'import' }
        : { status: 'ACTIVE' };
    }
    if (ev.verdict === 'BLOCK') {
      if (isSlt(u)) {
        if (d.overrideReason.length < 5) {
          throw U.err('NEEDS_OVERRIDE', 'This breaks the assessment policy. Give a reason to override it.', { evaluation: ev });
        }
        return { status: 'ACTIVE', overrideReason: d.overrideReason, overrideBy: u.email };
      }
      if (d.requestReason.length >= 5) return { status: 'PENDING', requestReason: d.requestReason };
      throw U.err('BLOCKED', 'This breaks the assessment policy. Pick another date or ask SLT to approve it.', { evaluation: ev });
    }
    if (ev.needsReason) {
      var reason = d.overrideReason || d.requestReason;
      if (reason.length < 5) throw U.err('NEEDS_REASON', 'Give a reason for going over the limit.', { evaluation: ev });
      return { status: 'ACTIVE', overrideReason: reason, overrideBy: u.email };
    }
    return { status: 'ACTIVE' };
  }

  function teacherFor(row, u) {
    var sec = row.sectionId ? Dir.section(row.sectionId) : null;
    if (!sec || sec.teachers.indexOf(u.email) >= 0 || !sec.teachers.length) return u.email;
    return sec.teachers[0];
  }

  function log(u, action, ref, details) {
    Store.append('Log', [{
      at: Svc.stamp(), user: u.email, action: action, ref: ref,
      details: JSON.stringify(details || {}).slice(0, 2000)
    }]);
  }

  /** Copies an entry to the grade calendars and records where the copies are. */
  function syncMirror(e) {
    var res;
    try {
      res = Mirror.sync(e);
    } catch (x) {
      res = { mirror: e.mirror, status: 'ERROR ' + x.message };
    }
    saveMirror(e, res);
  }

  function saveMirror(e, res) {
    if (JSON.stringify(res.mirror) === JSON.stringify(e.mirror) && res.status === e.mirror_status) return;
    Svc.withLock(function () {
      reload();
      var fresh = byId(e.id);
      if (!fresh) return;
      fresh.mirror = res.mirror;
      fresh.mirror_status = res.status;
      write(fresh);
    });
    e.mirror = res.mirror;
    e.mirror_status = res.status;
  }

  function create(raw, u) {
    if (!canBook(u)) throw U.err('FORBIDDEN', 'Your account can view the calendar but not add to it.');
    var d = sanitize(raw, false);

    var result = Svc.withLock(function () {
      reload();
      var imp = null;
      if (d.importId) {
        Store.invalidate('ImportQueue');
        imp = Mirror.openImport(d.importId, u);
      }
      var ev = Rules.evaluate(d, u);
      var decision = decide(ev, d, u, !!imp);
      var now = Svc.stamp();
      var gid = U.uid('G');
      var rows = d.rows.map(function (r) {
        return {
          id: U.uid('A'), group_id: gid, status: decision.status, category: d.category, format: d.format,
          title: d.title, notes: d.notes, section_id: r.sectionId, grade: r.sectionId ? '' : r.grade,
          date: r.date, periods: r.periods.join(','), announced: d.announced,
          teacher_email: teacherFor(r, u), created_by: u.email, created_at: now,
          updated_by: u.email, updated_at: now,
          request_reason: decision.requestReason || '', override_reason: decision.overrideReason || '',
          override_by: decision.overrideBy || '', decided_by: '', decided_at: '', decision_note: '',
          mirror: '', mirror_status: '', source: imp ? 'IMPORT' : 'APP', source_ref: imp ? imp.import_id : ''
        };
      });
      Store.append('Assessments', rows);
      if (imp) Mirror.markImport(imp, 'CLAIMED', rows.map(function (r) { return r.id; }), u);
      log(u, decision.status === 'PENDING' ? 'REQUEST' : (decision.overrideBy ? 'OVERRIDE' : 'CREATE'), gid,
        { title: d.title, rows: d.rows, reason: decision.requestReason || decision.overrideReason || '' });
      cache = null;
      return { ids: rows.map(function (r) { return r.id; }), decision: decision, evaluation: ev, imp: imp };
    });

    var entries = result.ids.map(byId);
    if (result.imp) Mirror.adopt(result.imp, entries);
    entries.forEach(syncMirror);
    if (result.decision.status === 'PENDING') notifyRequest(entries, u);
    return {
      status: result.decision.status,
      entries: entries.map(function (e) { return project(e, u); }),
      evaluation: result.evaluation
    };
  }

  function update(req, u) {
    req = req || {};
    var id = U.clean(req.id);
    var patch = req.patch || {};
    var result = Svc.withLock(function () {
      reload();
      var e = byId(id);
      if (!e || e.status === 'CANCELLED') throw U.err('NOT_FOUND', 'That entry no longer exists.');
      if (!canEdit(e, u)) throw U.err('FORBIDDEN', 'You can only change your own entries before their date.');
      var next = {};
      Object.keys(e).forEach(function (k) { next[k] = e[k]; });
      var schedule = false;

      if ('title' in patch) {
        next.title = U.clean(patch.title).slice(0, 120);
        if (!next.title) throw U.err('INVALID', 'Give the assessment a title.', { field: 'title' });
      }
      if ('notes' in patch) next.notes = String(patch.notes || '').trim().slice(0, 1000);
      if ('format' in patch) next.format = U.clean(patch.format).slice(0, 60);
      if ('announced' in patch) next.announced = U.bool(patch.announced);
      if ('category' in patch) {
        var c = U.clean(patch.category).toUpperCase();
        if (!Config.category(c)) throw U.err('INVALID', 'Choose a category.', { field: 'category' });
        if (c !== e.category) { next.category = c; schedule = true; }
      }
      if ('date' in patch) {
        var dt = U.normDate(patch.date);
        if (!dt) throw U.err('INVALID', 'Choose a date.', { field: 'date' });
        if (dt !== e.date) { next.date = dt; schedule = true; }
      }
      if ('periods' in patch) {
        var ps = normPeriods(patch.periods);
        if (ps.join(',') !== e.periods.join(',')) { next.periods = ps; schedule = true; }
      }
      if ('sectionId' in patch || 'grade' in patch) {
        var sid = U.clean(patch.sectionId);
        var g = sid ? '' : U.normGrade(patch.grade);
        if (sid !== e.section_id || g !== e.grade) {
          next.section_id = sid;
          next.grade = g;
          next.teacher_email = teacherFor({ sectionId: sid }, u);
          schedule = true;
        }
      }

      var ev = null;
      var decision = null;
      if (schedule || e.status === 'DECLINED') {
        ev = Rules.evaluate({
          category: next.category,
          rows: [{ sectionId: next.section_id, grade: next.grade, date: next.date, periods: next.periods }],
          excludeIds: [e.id]
        }, u);
        decision = decide(ev, {
          overrideReason: U.clean(patch.overrideReason), requestReason: U.clean(patch.requestReason)
        }, u, false);
        next.status = decision.status;
        next.request_reason = decision.requestReason || '';
        next.override_reason = decision.overrideReason || '';
        next.override_by = decision.overrideBy || '';
        next.decided_by = '';
        next.decided_at = '';
        next.decision_note = '';
      }
      next.updated_by = u.email;
      next.updated_at = Svc.stamp();
      if (e.mirror_status === 'SOURCE') Mirror.takeOver(next);
      write(next);
      log(u, decision && decision.status === 'PENDING' ? 'REQUEST' : 'UPDATE', id, { patch: patch, status: next.status });
      return { entry: next, evaluation: ev, before: e.status };
    });
    syncMirror(result.entry);
    if (result.entry.status === 'PENDING' && result.before !== 'PENDING') notifyRequest([result.entry], u);
    return { status: result.entry.status, entry: project(result.entry, u), evaluation: result.evaluation };
  }

  function remove(req, u) {
    var id = U.clean(req && req.id);
    var e = Svc.withLock(function () {
      reload();
      var x = byId(id);
      if (!x || x.status === 'CANCELLED') throw U.err('NOT_FOUND', 'That entry no longer exists.');
      if (!canEdit(x, u)) throw U.err('FORBIDDEN', 'You can only delete your own entries before their date.');
      x.status = 'CANCELLED';
      x.updated_by = u.email;
      x.updated_at = Svc.stamp();
      write(x);
      log(u, 'DELETE', id, { title: x.title, date: x.date });
      return x;
    });
    syncMirror(e);
    return { id: id };
  }

  /** SLT approves or declines a PENDING request. */
  function decideRequest(req, u) {
    if (!isSlt(u)) throw U.err('FORBIDDEN', 'Only SLT can approve or decline requests.');
    req = req || {};
    var approve = req.approve === true;
    var note = U.clean(req.note).slice(0, 500);
    var e = Svc.withLock(function () {
      reload();
      var x = byId(U.clean(req.id));
      if (!x) throw U.err('NOT_FOUND', 'That request no longer exists.');
      if (x.status !== 'PENDING') throw U.err('CONFLICT', 'Someone has already handled this request.');
      if (approve) {
        var ev = Rules.evaluate({
          category: x.category,
          rows: [{ sectionId: x.section_id, grade: x.grade, date: x.date, periods: x.periods }],
          excludeIds: [x.id]
        }, u, { noSuggestions: true });
        if (ev.verdict === 'INVALID') {
          throw U.err('INVALID', 'This can no longer be approved: ' + ev.rows[0].issues.filter(function (i) {
            return i.level === 'INVALID';
          })[0].title, { evaluation: ev });
        }
        x.status = 'ACTIVE';
        x.override_by = u.email;
        x.override_reason = 'Approved request: ' + x.request_reason;
      } else {
        x.status = 'DECLINED';
      }
      x.decided_by = u.email;
      x.decided_at = Svc.stamp();
      x.decision_note = note;
      x.updated_by = u.email;
      x.updated_at = x.decided_at;
      write(x);
      log(u, approve ? 'APPROVE' : 'DECLINE', x.id, { note: note });
      return x;
    });
    syncMirror(e);
    notifyDecision(e, u);
    return { status: e.status, entry: project(e, u) };
  }

  /* ------------------------------------------------------------------
     Email
     ------------------------------------------------------------------ */

  function appLink(params) {
    var s = Config.get();
    var url = s.appUrl || Svc.appUrl();
    return url ? url + (params ? '?' + params : '') : '';
  }

  function sltRecipients() {
    var s = Config.get();
    if (s.sltNotifyEmails.length) return s.sltNotifyEmails;
    var staff = Dir.load().staff;
    var slt = Object.keys(staff).filter(function (e) { return staff[e].role === 'SLT'; });
    if (slt.length) return slt;
    return Object.keys(staff).filter(function (e) { return staff[e].role === 'ADMIN'; });
  }

  function describeEntry(e) {
    var sec = e.section_id ? Dir.section(e.section_id) : null;
    return (sec ? Dir.label(sec) : 'All of Grade ' + e.grade) + ' on ' + U.human(e.date) +
      (e.periods.length ? ' (P' + e.periods.join(', P') + ')' : '');
  }

  function notifyRequest(entries, u) {
    var to = sltRecipients();
    if (!to.length) return;
    var e = entries[0];
    var cat = Config.category(e.category);
    var body = [
      (u.name || u.email) + ' asked SLT to approve an assessment that breaks the assessment policy.',
      '',
      (cat ? cat.label : e.category) + ': ' + e.title,
      entries.map(describeEntry).join('\n'),
      '',
      'Reason given: ' + e.request_reason,
      '',
      'Approve or decline it in the Assessment Calendar:',
      appLink('view=requests')
    ].join('\n');
    try {
      Svc.sendMail({ to: to.join(','), subject: 'Approval needed: ' + e.title + ', ' + U.human(e.date), body: body, replyTo: u.email });
    } catch (x) {
      Svc.log('Could not email SLT: ' + x.message);
    }
  }

  function notifyDecision(e, u) {
    var to = U.uniq([e.teacher_email, e.created_by].filter(Boolean)).filter(function (x) { return x !== u.email; });
    if (!to.length) return;
    var approved = e.status === 'ACTIVE';
    var body = [
      (u.name || u.email) + (approved ? ' approved ' : ' declined ') + 'your request:',
      '',
      e.title + ': ' + describeEntry(e),
      e.decision_note ? '\nNote: ' + e.decision_note : '',
      '',
      approved ? 'It is now on the calendar.' : 'Pick another date in the Assessment Calendar and save it again.',
      appLink('')
    ].join('\n');
    try {
      Svc.sendMail({ to: to.join(','), subject: (approved ? 'Approved: ' : 'Declined: ') + e.title, body: body, replyTo: u.email });
    } catch (x) {
      Svc.log('Could not email the teacher: ' + x.message);
    }
  }

  function reset() { cache = null; }

  return {
    norm: norm, all: all, reload: reload, byId: byId, canEdit: canEdit, visibleTo: visibleTo,
    project: project, parseScope: parseScope, listRange: listRange, pending: pending,
    pendingCount: pendingCount, sanitize: sanitize, create: create, update: update,
    remove: remove, decideRequest: decideRequest, syncMirror: syncMirror,
    saveMirror: saveMirror, save: write, isSlt: isSlt, canBook: canBook, reset: reset
  };
})();
