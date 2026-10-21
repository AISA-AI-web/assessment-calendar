/**
 * WebApp.gs: the page, the Sheet menu, Set up, and the hourly trigger.
 *
 * Deploy as a web app: Execute as "Me", access "Anyone within aisa.sch.ae".
 * The page arrives with its first data already inside it (one server call per
 * page load), and the browser asks for more through Api.gs.
 */

function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var boot = Api.run(function (u) { return Api.bootstrap(u); });
    if (!boot.ok && boot.error.code === 'NO_ACCESS') return noAccessPage_(boot.error.message);
    var t = HtmlService.createTemplateFromFile('Index');
    t.bootstrapJson = safeJson_(boot);
    t.paramsJson = safeJson_({ view: params.view || '', date: params.date || '', scope: params.scope || '' });
    var title = boot.ok ? boot.data.settings.appTitle : 'Assessment Calendar';
    return t.evaluate()
      .setTitle(title)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1');
  } catch (err) {
    console.error('doGet failed: ' + (err && err.stack ? err.stack : err));
    return startupErrorPage_(err);
  }
}

/** Shown instead of a raw Google error when the page itself cannot be built. */
function startupErrorPage_(err) {
  var message = (err && (err.userMessage || err.message)) || String(err);
  var html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:"DM Sans",Arial,sans-serif;color:#1A1A1A;max-width:640px;margin:48px auto;padding:0 16px;line-height:1.5}' +
    'h1{color:#21076C;font-size:24px}code{background:#F2EFFA;padding:2px 6px;border-radius:4px}</style></head><body>' +
    '<h1>The Assessment Calendar could not start</h1>' +
    '<p>The server said: <code>' + escapeHtml_(message) + '</code></p>' +
    '<p>This usually means one of these:</p><ul>' +
    '<li>Set up has not been run: open the Sheet → Assessment Calendar → 1. Set up.</li>' +
    '<li>The deployment is an old version: Deploy → Manage deployments → edit → Version: New version.</li>' +
    '<li>A file is missing from the Apps Script project (it needs Index, Styles and App HTML files).</li>' +
    '</ul></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Assessment Calendar');
}

/** Used by Index.html: <?!= include('Styles') ?> */
function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/**
 * JSON that is safe inside a <script> element. HTML-escaping would break
 * JSON.parse, so the characters that could end the element are escaped as
 * JSON unicode escapes instead.
 */
function safeJson_(o) {
  return JSON.stringify(o)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function escapeHtml_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function noAccessPage_(message) {
  var support = '';
  try { support = Config.get().supportEmail; } catch (e) { support = ''; }
  var html = '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<style>body{font-family:"DM Sans",Arial,sans-serif;color:#1A1A1A;max-width:560px;margin:64px auto;padding:0 16px}' +
    'h1{color:#21076C;font-size:24px}p{line-height:1.5}</style></head><body>' +
    '<h1>Assessment Calendar</h1><p>' + escapeHtml_(message) + '</p>' +
    (support ? '<p>Ask <a href="mailto:' + escapeHtml_(support) + '" target="_top">' + escapeHtml_(support) +
      '</a> to add you.</p>' : '<p>Ask Teaching &amp; Learning to add you.</p>') +
    '</body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Assessment Calendar');
}

/* ---------------------------------------------------------------------
   Set up
   ------------------------------------------------------------------ */

var Setup = (function () {
  'use strict';

  function setSetting(key, value) {
    var rows = Store.all('Settings');
    for (var i = 0; i < rows.length; i++) {
      if (U.clean(rows[i].key) === key) {
        rows[i].value = value;
        Store.update('Settings', rows[i]);
        return;
      }
    }
    Store.append('Settings', [{ key: key, value: value, notes: '' }]);
  }

  /**
   * Creates any missing tab and column, and fills in defaults without overwriting anything.
   * A tab that was already there with columns the app does not use may belong to something
   * else that used the same name, such as an earlier version of the calendar. Those tabs are
   * counted in foreign (name → number of such columns) and left as they are.
   */
  function run() {
    var created = [];
    var foreign = {};
    Object.keys(Store.SCHEMAS).forEach(function (name) {
      var schema = Store.SCHEMAS[name];
      if (Store.ensure(name)) {
        created.push(name);
      } else if (schema.length) {
        var n = Store.raw(name).headers.filter(function (h) { return h && schema.indexOf(h) < 0; }).length;
        if (n) foreign[name] = n;
      }
    });
    var have = U.toSet(Store.all('Settings').map(function (r) { return U.clean(r.key); }));
    var add = Config.DEFAULTS.filter(function (d) { return !have[d[0]]; })
      .map(function (d) { return { key: d[0], value: d[1], notes: d[2] }; });
    var me = Svc.userEmail();
    Svc.withLock(function () {
      Store.append('Settings', add);
      if (!Store.all('CalendarRules').length) {
        Store.append('CalendarRules', Days.DEFAULT_RULES.map(function (r) {
          return { pattern: r[0], category: r[1], notes: r[2] };
        }));
      }
      if (!Store.all('Bells').length) {
        Store.append('Bells', Config.DEFAULT_BELLS.map(function (b) {
          return { schedule: b[0], from: b[1], to: b[2], weekdays: b[3], period: b[4], start: b[5], end: b[6] };
        }));
      }
      var staff = Store.all('Staff');
      var hasAdmin = staff.some(function (r) { return U.clean(r.role).toUpperCase() === 'ADMIN'; });
      if (me && !hasAdmin && !staff.some(function (r) { return U.normEmail(r.email) === me; })) {
        Store.append('Staff', [{ email: me, name: '', role: 'ADMIN', notes: 'Added by Set up' }]);
      }
    });
    Config.reset();
    var s = Config.get();
    var found = '';
    if (!s.internalCalendarId && s.internalCalendarName) {
      found = Svc.calendarIdByName(s.internalCalendarName);
      if (found) Svc.withLock(function () { setSetting('internal_calendar_id', found); });
    }
    Config.reset();
    Dir.reset();
    Days.reset();
    return { created: created, foreign: foreign, settingsAdded: add.length, internalCalendarFound: !!found };
  }

  /** What Set up did, as plain lines for an alert box. */
  function describe(r) {
    var lines = [
      r.created.length ? 'Created tabs: ' + r.created.join(', ') + '.' : 'All tabs were already there.',
      r.settingsAdded ? 'Added ' + r.settingsAdded + ' settings with default values.' : 'No settings were missing.'
    ];
    if (r.internalCalendarFound) lines.push('Found the Internal Calendar and saved its ID.');
    lines.push('The Internal Calendar now syncs every hour.');
    var foreign = Object.keys(r.foreign);
    if (foreign.length) {
      lines.push('', 'These tabs may belong to something else, such as an earlier version of the calendar:');
      foreign.forEach(function (name) {
        var n = r.foreign[name];
        lines.push(name + ': ' + n + (n === 1 ? ' column' : ' columns') + ' the app does not use');
      });
      lines.push('If so, rename each one, e.g. to "' + foreign[0] + ' (earlier version)", and run Set up again: ' +
        'the app then makes fresh tabs. Nothing was renamed or deleted.');
    }
    lines.push('', 'Next: fill in the grade_calendar_* settings and the Staff tab (SLT and admins), then run step 2.');
    return lines.join('\n');
  }

  return { run: run, describe: describe, setSetting: setSetting };
})();

/* ---------------------------------------------------------------------
   Who may run menu items and triggers
   ------------------------------------------------------------------ */

/**
 * Menu items and triggers are ordinary global functions, so a signed-in
 * person could call them from the browser through google.script.run, where
 * they would run as the account that deployed the web app. They are only
 * allowed for whoever is actually running the script (the Sheet menu, a
 * trigger, the deployer) or for an ADMIN in the Staff tab.
 */
function requireAdminCaller_() {
  var active = Svc.userEmail();
  var effective = Svc.effectiveEmail();
  if (!active || active === effective) return;
  if (Dir.userFor(active).role === 'ADMIN') return;
  throw U.err('FORBIDDEN', 'Only admins can run this.');
}

/**
 * The Sheet menu is for admins only: the people with role ADMIN in the Staff
 * tab. Anyone else who can open the Sheet is refused, so sharing the Sheet
 * by mistake does not let them load a roster. Set up also lets the very first
 * person in, while the Staff tab has no ADMIN yet.
 */
function requireAdmin_(allowFirstRun) {
  var me = Svc.userEmail();
  if (me && Dir.userFor(me).role === 'ADMIN') return;
  if (allowFirstRun && !Store.all('Staff').some(function (r) { return U.clean(r.role).toUpperCase() === 'ADMIN'; })) return;
  throw U.err('FORBIDDEN', 'Only admins can use this menu. An admin can add ' + (me || 'your account') +
    ' to the Staff tab with role ADMIN.');
}

/* ---------------------------------------------------------------------
   Triggers
   ------------------------------------------------------------------ */

function cronHourly() {
  requireAdminCaller_();
  try { Days.sync(); } catch (e) { console.error('Internal Calendar sync failed: ' + (e.stack || e)); }
  try { Mirror.retryFailed(); } catch (e) { console.error('Mirror retry failed: ' + (e.stack || e)); }
}

function installTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'cronHourly') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('cronHourly').timeBased().everyHours(1).create();
}

/* ---------------------------------------------------------------------
   The Sheet menu
   ------------------------------------------------------------------ */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Assessment Calendar')
    .addItem('1. Set up or repair this Sheet', 'menuSetup')
    .addItem('2. Sync the Internal Calendar now', 'menuSyncInternal')
    .addItem('3. Load the class roster from the Roster tab', 'menuLoadRoster')
    .addItem('4. Import entries from the grade calendars', 'menuImportGradeCalendars')
    .addSeparator()
    .addItem('Re-copy every entry to the grade calendars', 'menuResyncMirror')
    .addItem('Open the web app', 'menuOpenApp')
    .addToUi();
}

function alert_(title, message) {
  SpreadsheetApp.getUi().alert(title, message, SpreadsheetApp.getUi().ButtonSet.OK);
}

function guarded_(title, fn) {
  try {
    alert_(title, fn());
  } catch (e) {
    alert_(title, 'It did not work: ' + (e.userMessage || e.message));
  }
}

function menuSetup() {
  requireAdminCaller_();
  guarded_('Set up', function () {
    requireAdmin_(true);
    SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone('Asia/Dubai');
    var r = Setup.run();
    installTriggers_();
    return Setup.describe(r);
  });
}

function menuSyncInternal() {
  requireAdminCaller_();
  guarded_('Internal Calendar', function () {
    requireAdmin_();
    var r = Days.sync();
    return 'Copied ' + r.events + ' events. Check the InternalEvents tab: correct any event with override_category or override_grades.';
  });
}

/** One step: shows what the Roster tab contains, then loads it if the admin says yes. */
function menuLoadRoster() {
  requireAdminCaller_();
  var ui = SpreadsheetApp.getUi();
  try {
    requireAdmin_();
    var check = PsImport.process({ dryRun: true });
    if (check.errors.length) {
      alert_('Class roster', PsImport.describe(check));
      return;
    }
    var answer = ui.alert('Load the class roster?',
      PsImport.describe(check) + '\n\nLoad it now? This replaces the roster the app is using.', ui.ButtonSet.YES_NO);
    if (answer !== ui.Button.YES) {
      alert_('Class roster', 'Nothing was changed.');
      return;
    }
    alert_('Class roster', PsImport.describe(PsImport.process()));
  } catch (e) {
    alert_('Class roster', 'It did not work: ' + (e.userMessage || e.message));
  }
}

function menuImportGradeCalendars() {
  requireAdminCaller_();
  guarded_('Grade calendars', function () {
    requireAdmin_();
    var r = Mirror.importExisting();
    var per = Object.keys(r.perGrade).map(function (g) { return 'Grade ' + g + ': ' + r.perGrade[g]; }).join(', ');
    return r.added
      ? 'Queued ' + r.added + ' events dated from ' + r.from + ' (' + per + '). Their creators will see them in the app under "From the old calendars".'
      : 'Nothing new to import from ' + r.from + '.';
  });
}

function menuResyncMirror() {
  requireAdminCaller_();
  guarded_('Grade calendars', function () {
    requireAdmin_();
    var r = Mirror.resyncAll();
    return 'Updated ' + r.synced + ' entries.' + (r.remaining ? ' ' + r.remaining + ' are left: run this again.' : '');
  });
}

function menuOpenApp() {
  requireAdminCaller_();
  guarded_('Web app', function () {
    requireAdmin_();
    var url = Config.get().appUrl || Svc.appUrl();
    return url ? url : 'Deploy the web app first: Deploy → New deployment → Web app.';
  });
}
