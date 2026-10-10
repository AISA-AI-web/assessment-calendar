/**
 * WebApp.gs: the page, the Sheet menu, Set up, and the hourly trigger.
 *
 * Deploy as a web app: Execute as "Me", access "Anyone within aisa.sch.ae".
 * The page arrives with its first data already inside it (one server call per
 * page load), and the browser asks for more through Api.gs.
 */

function doGet(e) {
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

  /** Creates any missing tab and column, and fills in defaults without overwriting anything. */
  function run() {
    var created = [];
    Object.keys(Store.SCHEMAS).forEach(function (name) {
      if (Store.ensure(name)) created.push(name);
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
    return { created: created, settingsAdded: add.length, internalCalendarFound: !!found };
  }

  return { run: run, setSetting: setSetting };
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
    .addItem('3. Process PowerSchool import', 'menuProcessImport')
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
    SpreadsheetApp.getActiveSpreadsheet().setSpreadsheetTimeZone('Asia/Dubai');
    var r = Setup.run();
    installTriggers_();
    var lines = [
      r.created.length ? 'Created tabs: ' + r.created.join(', ') + '.' : 'All tabs were already there.',
      r.settingsAdded ? 'Added ' + r.settingsAdded + ' settings with default values.' : 'No settings were missing.'
    ];
    if (r.internalCalendarFound) lines.push('Found the Internal Calendar and saved its ID.');
    lines.push('The Internal Calendar now syncs every hour.', '',
      'Next: fill in the grade_calendar_* settings and the Staff tab (SLT and admins), then run step 2.');
    return lines.join('\n');
  });
}

function menuSyncInternal() {
  requireAdminCaller_();
  guarded_('Internal Calendar', function () {
    var r = Days.sync();
    return 'Copied ' + r.events + ' events. Check the InternalEvents tab: correct any event with override_category or override_grades.';
  });
}

function menuProcessImport() {
  requireAdminCaller_();
  guarded_('PowerSchool import', function () { return PsImport.describe(PsImport.process()); });
}

function menuImportGradeCalendars() {
  requireAdminCaller_();
  guarded_('Grade calendars', function () {
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
    var r = Mirror.resyncAll();
    return 'Updated ' + r.synced + ' entries.' + (r.remaining ? ' ' + r.remaining + ' are left: run this again.' : '');
  });
}

function menuOpenApp() {
  requireAdminCaller_();
  var url = Config.get().appUrl || Svc.appUrl();
  alert_('Web app', url ? url : 'Deploy the web app first: Deploy → New deployment → Web app.');
}
