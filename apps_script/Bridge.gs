/**
 * Bridge.gs: the Assessment Calendar's Google side, after its move to the school's Supabase project.
 *
 * The calendar now runs on Supabase (AISA-AI-web/AI-Lessons: assessment-calendar/ and the `assessments` edge
 * function). What only Google can do stays here, in the old Apps Script project, run as the account that
 * deployed it, which can read the AISA (Internal Calendar) and change the grade calendars:
 *
 *   bridgeRun        every minute (a trigger made by bridgeSwitch): asks the server what to do; reads the
 *                    Internal Calendar and the grade calendars when they are due (hourly, or straight away when
 *                    an admin asks on the web app); brings entries' copies on the grade calendars up to date
 *                    exactly as the old Mirror.sync did; sends the emails (as MailApp did); reports back.
 *
 * Run these once from the Apps Script editor (choose the function, then Run), as that account:
 *
 *   bridgeSetup      makes the bridge's key (kept in Script Properties as BRIDGE_KEY, never shown) and writes
 *                    its SHA-256 in the execution log: paste that into Supabase as the edge function's secret
 *                    ASSESSMENT_CALENDAR_BRIDGE_KEY_SHA256 (it is not a secret: the key cannot be worked out from it)
 *   bridgeCheck      checks that the server knows the key, and shows what it holds
 *   bridgeCopySheet  copies every tab of this Sheet to the new database – until the switch, as often as needed;
 *                    each copy replaces the last
 *   bridgeSwitch     the switch: closes this web app (MOVED_TO: every old link opens the new site), copies the
 *                    Sheet one last time, tells the server, and replaces the old hourly sync with bridgeRun
 *
 * It uses this project's own Svc (Svc.gs) for the calendars and mail, and Store (Store.gs) to read the Sheet.
 * Needs the scope https://www.googleapis.com/auth/script.external_request in appsscript.json (UrlFetchApp).
 * The source is AISA-AI-web/AI-Lessons: assessment-calendar/bridge/Bridge.gs.
 */
var Bridge = (function () {
  'use strict';

  var DEFAULT_URL = 'https://kttgudordfvhdrkcancp.supabase.co/functions/v1/assessments';
  var TABS = ['Settings', 'Staff', 'Sections', 'CourseNames', 'Enrolments', 'Assessments', 'InternalEvents',
    'CalendarRules', 'Bells', 'ImportQueue', 'Log'];
  var PART = 2000;                   // rows per request when copying the Sheet
  var BUDGET = 4 * 60 * 1000;        // stop starting new calendar work after 4 minutes (Apps Script stops at 6)

  function props() { return PropertiesService.getScriptProperties(); }

  function url() { return String(props().getProperty('BRIDGE_URL') || DEFAULT_URL).trim(); }

  function key() {
    var k = props().getProperty('BRIDGE_KEY');
    if (!k) throw new Error('The bridge has no key yet: run bridgeSetup first.');
    return k;
  }

  function sha256(s) {
    return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8).map(function (b) {
      var x = (b < 0 ? b + 256 : b).toString(16);
      return x.length < 2 ? '0' + x : x;
    }).join('');
  }

  /** One request to the server. Returns its data, or throws with its message. */
  function call(action, payload) {
    var body = { action: action, key: key() };
    Object.keys(payload || {}).forEach(function (k) { body[k] = payload[k]; });
    var res = UrlFetchApp.fetch(url(), {
      method: 'post', contentType: 'text/plain; charset=utf-8', payload: JSON.stringify(body),
      muteHttpExceptions: true, followRedirects: false
    });
    var text = res.getContentText();
    var out;
    try { out = JSON.parse(text); } catch (e) { throw new Error('The server answered ' + res.getResponseCode() + ': ' + text.slice(0, 200)); }
    if (!out.ok) throw new Error((out.error && out.error.message) || 'The server refused (' + res.getResponseCode() + ').');
    return out.data;
  }

  /* ------------------------------------------------------------------
     The work of one run (no network here: bridgeRun asks and reports)
     ------------------------------------------------------------------ */

  /** Reads what the server asked for: the Internal Calendar, and the grade calendars (with who posted each event). */
  function read(todo) {
    var out = {};
    var r = todo.read || {};
    if (r.internal) {
      var id = r.internal.id || Svc.calendarIdByName(r.internal.name);
      if (!id) {
        out.internal = { id: '', error: 'Cannot find the Internal Calendar ("' + r.internal.name + '"). Put its Calendar ID in Settings, internal_calendar_id.' };
      } else {
        try {
          out.internal = { id: id, events: Svc.calendarEvents(id, r.internal.from, r.internal.to) };
        } catch (x) {
          out.internal = { id: id, error: String(x.message || x) };
        }
      }
    }
    if (r.grades) {
      var cals = {};
      r.grades.calendars.forEach(function (c) {
        if (cals[c.cal]) return;
        try {
          cals[c.cal] = { events: Svc.calendarEvents(c.cal, r.grades.from, r.grades.to, true) };
        } catch (x) {
          cals[c.cal] = { error: String(x.message || x) };
        }
      });
      out.grades = { mode: r.grades.mode, from: r.grades.from, calendars: cals };
    }
    return out;
  }

  /**
   * Brings one entry's copies in line with its plan (the old Mirror.sync, step for step): copies on grades no
   * longer wanted are deleted, then each wanted grade's copy is created or updated – moved first if its grade
   * calendar has changed. Returns { id, seq, mirror, status }.
   */
  function reconcile(item) {
    var p = item.plan;
    var current = p.have || {};
    var mirror = {};
    Object.keys(current).forEach(function (g) { mirror[g] = current[g]; });
    var want = p.want.map(function (w) { return w.grade; });
    var errors = [];

    Object.keys(mirror).forEach(function (g) {
      if (want.indexOf(g) >= 0) return;
      var m = mirror[g] || {};
      try {
        if (m.id) Svc.calendarDelete(m.cal || p.calendars[g], m.id);
        delete mirror[g];
      } catch (x) {
        errors.push('Grade ' + g + ': ' + x.message);
      }
    });

    p.want.forEach(function (w) {
      var g = w.grade;
      var m = mirror[g] || {};
      try {
        if (m.id && m.cal && m.cal !== w.cal) {
          try { Svc.calendarDelete(m.cal, m.id); } catch (ignored) { /* the old calendar may be gone */ }
          m = {};
        }
        mirror[g] = { id: Svc.calendarUpsert(w.cal, m.id || '', w.spec), cal: w.cal };
      } catch (x) {
        errors.push('Grade ' + g + ': ' + x.message);
      }
    });

    return {
      id: item.id, seq: item.seq, mirror: mirror,
      status: errors.length ? ('ERROR ' + errors.join('; ')).slice(0, 300) : (want.length ? 'OK' : '')
    };
  }

  /** An email, or an old event to delete (when an import claimed it). */
  function deliver(o) {
    try {
      if (o.kind === 'mail') {
        Svc.sendMail({ to: o.payload.to, subject: o.payload.subject, body: o.payload.body, replyTo: o.payload.replyTo || '' });
      } else if (o.kind === 'delete_event') {
        Svc.calendarDelete(o.payload.cal, o.payload.id);
      }
      return { id: o.id, error: '' };
    } catch (x) {
      return { id: o.id, error: String(x.message || x).slice(0, 300) };
    }
  }

  /** Everything the server asked for (bridgePoll's answer) → the report for bridgeReport. */
  function work(todo) {
    var started = Date.now();
    var report = read(todo);
    report.mirror = [];
    (todo.mirror || []).some(function (item) {
      if (Date.now() - started > BUDGET) return true;     // the rest wait for the next run
      report.mirror.push(reconcile(item));
      return false;
    });
    report.outbox = [];
    (todo.outbox || []).some(function (o) {
      if (Date.now() - started > BUDGET) return true;
      report.outbox.push(deliver(o));
      return false;
    });
    return report;
  }

  /* ------------------------------------------------------------------
     Copying the Sheet
     ------------------------------------------------------------------ */

  /** A cell as the text the old app read: dates as yyyy-mm-dd, times of day as HH:mm (as U.normDate/normTime read them). */
  function cellText(v) {
    if (v === null || v === undefined) return '';
    if (v === true) return 'TRUE';
    if (v === false) return 'FALSE';
    if (U.isDate(v)) {
      if (isNaN(v.getTime())) return '';
      if (v.getFullYear() < 1900) return U.pad2(v.getHours()) + ':' + U.pad2(v.getMinutes());       // a time on its own
      var day = U.fromDate(v);
      return v.getHours() || v.getMinutes() || v.getSeconds()
        ? day + 'T' + U.pad2(v.getHours()) + ':' + U.pad2(v.getMinutes()) + ':' + U.pad2(v.getSeconds()) : day;
    }
    return String(v);
  }

  /** Every tab of the Sheet, in parts of at most PART rows: [{ table, part, rows, last }]. */
  function sheetParts() {
    var parts = [];
    TABS.forEach(function (tab) {
      Store.invalidate(tab);
      var rows = Store.all(tab).map(function (r) {
        var o = {};
        Store.SCHEMAS[tab].forEach(function (h) { o[h] = cellText(r[h]); });
        return o;
      });
      for (var i = 0; i === 0 || i < rows.length; i += PART) parts.push({ table: tab, part: i / PART, rows: rows.slice(i, i + PART) });
    });
    parts[parts.length - 1].last = true;
    return parts;
  }

  function copySheet() {
    var parts = sheetParts();
    var counts = null;
    parts.forEach(function (p) {
      var res = call('bridgeCopy', p);
      if (res.counts) counts = res.counts;
    });
    return counts;
  }

  /* ------------------------------------------------------------------
     The switch
     ------------------------------------------------------------------ */

  /** The new site's address once the switch is done (Script property MOVED_TO), otherwise ''. Always '' where there are
      no Script Properties (the old repository's tests and preview). */
  function movedTo() {
    if (typeof PropertiesService === 'undefined') return '';
    var m = String(props().getProperty('MOVED_TO') || '').trim();
    return /^https:\/\/[a-z0-9.\-]+(:\d+)?\/?$/i.test(m) ? m.replace(/\/$/, '') : '';
  }

  function installRun() {
    ScriptApp.getProjectTriggers().forEach(function (t) {
      var f = t.getHandlerFunction();
      if (f === 'cronHourly' || f === 'bridgeRun') ScriptApp.deleteTrigger(t);
    });
    ScriptApp.newTrigger('bridgeRun').timeBased().everyMinutes(1).create();
  }

  return {
    TABS: TABS, url: url, key: key, sha256: sha256, call: call, read: read, reconcile: reconcile, deliver: deliver,
    work: work, cellText: cellText, sheetParts: sheetParts, copySheet: copySheet, movedTo: movedTo, installRun: installRun
  };
})();

/* ---------------------------------------------------------------------
   Run from the Apps Script editor, or by the trigger. Like the old menu items, each one only runs for the
   account that runs the script (the editor, the trigger) or for an ADMIN in the Staff tab: a web app user could
   otherwise call them through google.script.run (requireAdminCaller_, WebApp.gs).
   ------------------------------------------------------------------ */

function bridgeSetup() {
  requireAdminCaller_();
  var p = PropertiesService.getScriptProperties();
  var made = false;
  if (!p.getProperty('BRIDGE_KEY')) {
    p.setProperty('BRIDGE_KEY', Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, ''));
    made = true;
  }
  console.log((made ? 'Made the bridge\'s key. ' : 'The bridge already has a key. ') +
    'In Supabase → Edge Functions → Secrets, set ASSESSMENT_CALENDAR_BRIDGE_KEY_SHA256 to:\n' + Bridge.sha256(Bridge.key()) +
    '\n(This is not the key, and the key cannot be worked out from it.) Then run bridgeCheck.');
}

function bridgeCheck() {
  requireAdminCaller_();
  var s = Bridge.call('bridgeStatus', {});
  console.log('The server at ' + Bridge.url() + ' knows the bridge. The new site: ' + s.site + '\nIt holds: ' + JSON.stringify(s.counts) +
    '\nBridge: ' + JSON.stringify(s.state));
}

function bridgeCopySheet() {
  requireAdminCaller_();
  var counts = Bridge.copySheet();
  console.log('Copied every tab of this Sheet to the new database. It now holds: ' + JSON.stringify(counts));
}

function bridgeSwitch() {
  requireAdminCaller_();
  var site = String(Bridge.call('bridgeStatus', {}).site || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(site)) throw new Error('The server does not know its own address (ASSESSMENT_CALENDAR_ORIGINS).');
  PropertiesService.getScriptProperties().setProperty('MOVED_TO', site);        // from now on the old app takes no changes
  var counts = Bridge.copySheet();
  Bridge.call('bridgeSwitch', {});
  Bridge.installRun();
  console.log('Switched. Old links now open ' + site + '. The database holds: ' + JSON.stringify(counts) +
    '. bridgeRun now runs every minute instead of the old hourly sync.');
}

/** Every minute (the trigger made by bridgeSwitch). */
function bridgeRun() {
  requireAdminCaller_();
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;                  // the last run is still going
  try {
    var todo = Bridge.call('bridgePoll', {});
    Bridge.call('bridgeReport', Bridge.work(todo));
  } catch (e) {
    console.error('Bridge run failed: ' + (e && e.stack ? e.stack : e));
    try { Bridge.call('bridgeReport', { error: String((e && e.message) || e).slice(0, 300) }); } catch (ignored) { /* the server is out of reach */ }
  } finally {
    lock.releaseLock();
  }
}

/* ---------------------------------------------------------------------
   After the switch the old app takes no changes: doGet shows bridgeMovedPage_ and Api.run refuses, once
   MOVED_TO is set (both checks are added to WebApp.gs and Api.gs with this file).
   ------------------------------------------------------------------ */

function bridgeMovedTo_() { return Bridge.movedTo(); }

function bridgeMovedPage_(e) {
  var p = (e && e.parameter) || {};
  var q = [];
  ['view', 'date', 'scope'].forEach(function (k) {
    var v = String(p[k] || '');
    if (/^[A-Za-z0-9:_\-]{1,60}$/.test(v)) q.push(k + '=' + encodeURIComponent(v));
  });
  var to = Bridge.movedTo() + '/' + (q.length ? '?' + q.join('&') : '');
  var html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:"DM Sans",Arial,sans-serif;color:#1A1A1A;max-width:560px;margin:64px auto;padding:0 16px;line-height:1.5}' +
    'h1{color:#21076C;font-size:24px}a{color:#21076C;font-weight:700}</style></head><body>' +
    '<h1>The Assessment Calendar has moved</h1>' +
    '<p>The Assessment Calendar has a new home, and it is quicker. Sign in there with your school account: every booking has moved with it.</p>' +
    '<p><a href="' + escapeHtml_(to) + '" target="_top">Open the Assessment Calendar →</a></p>' +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('The Assessment Calendar has moved');
}
