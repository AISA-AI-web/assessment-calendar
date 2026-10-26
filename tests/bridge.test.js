'use strict';

// Bridge.gs: what stays in Google once the calendar has moved to its new server
// (the source is AISA-AI-web/AI-Lessons, assessment-calendar/bridge/Bridge.gs).
// The server itself is not here: these tests answer for it, as UrlFetchApp would.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { load, fresh, call } = require('./harness');

const g = load();
const SITE = 'https://calendar.school.example';
const log = console.log;
test.afterEach(() => { console.log = log; });

/** The script's own account, as in the editor or a trigger: no web app user. */
function asScript() {
  const t = fresh();
  t.as('');
  return t;
}

/** Script Properties, the server (answer(body) → its reply), the triggers and the log, as Google would give them. */
function google(answer) {
  const props = {};
  const sent = [];
  const triggers = [{ f: 'cronHourly' }];
  const logs = [];
  g.PropertiesService = {
    getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } })
  };
  g.HtmlService = { createHtmlOutput: (html) => ({ html, title: '', setTitle(t) { this.title = t; return this; } }) };
  g.Utilities = {
    DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
    computeDigest: (alg, s) => Array.from(crypto.createHash(alg).update(s, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
    getUuid: () => crypto.randomUUID()
  };
  g.UrlFetchApp = {
    fetch: (url, opts) => {
      const body = JSON.parse(opts.payload);
      sent.push({ url, body });
      const reply = answer ? answer(body) : { ok: true, data: {} };
      const text = typeof reply === 'string' ? reply : JSON.stringify(reply);
      return { getContentText: () => text, getResponseCode: () => (typeof reply === 'string' ? 502 : 200) };
    }
  };
  g.ScriptApp = {
    getProjectTriggers: () => triggers.map((t) => ({ getHandlerFunction: () => t.f, t })),
    deleteTrigger: (x) => triggers.splice(triggers.indexOf(x.t), 1),
    newTrigger: (f) => ({ timeBased: () => ({ everyMinutes: (n) => ({ create: () => triggers.push({ f, every: n }) }) }) })
  };
  console.log = (msg) => logs.push(String(msg));
  return { props, sent, triggers, logs };
}

test('without Script Properties (these tests, the preview) the calendar has not moved', () => {
  delete g.PropertiesService;
  assert.equal(g.bridgeMovedTo_(), '');
  fresh();
  assert.equal(call(g, 'apiBootstrap').ok, true);
});

test('once MOVED_TO is set, the old app takes no changes and its links open the new site', () => {
  const t = fresh();
  const env = google();
  env.props.MOVED_TO = SITE + '/';
  assert.equal(g.bridgeMovedTo_(), SITE);

  const res = call(g, 'apiCreate', { title: 'Cells unit test', category: 'SUMMATIVE', rows: [] });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'MOVED');
  assert.equal(call(g, 'apiBootstrap').error.code, 'MOVED');

  const page = g.doGet({ parameter: { view: 'week', date: '2026-10-27', scope: '<script>' } });
  assert.equal(page.title, 'The Assessment Calendar has moved');
  assert.ok(page.html.includes('href="' + SITE + '/?view=week&amp;date=2026-10-27"'), page.html);
  assert.ok(!page.html.includes('<script>'));

  assert.throws(() => g.requireAdmin_(true), /has moved to https:\/\/calendar\.school\.example/);
  t.as('');                                                  // the trigger runs as the script's own account
  let synced = false;
  const sync = g.Days.sync;
  g.Days.sync = () => { synced = true; };
  try { g.cronHourly(); } finally { g.Days.sync = sync; }
  assert.equal(synced, false, 'bridgeRun does the hourly work now');
});

test('a MOVED_TO that is not an https address is ignored', () => {
  fresh();
  const env = google();
  for (const m of ['http://calendar.school.example', 'javascript:alert(1)', 'https://calendar.school.example/path', ' ']) {
    env.props.MOVED_TO = m;
    assert.equal(g.bridgeMovedTo_(), '', m);
  }
  assert.equal(call(g, 'apiBootstrap').ok, true);
});

test('bridgeSetup makes the key once and shows only its SHA-256', () => {
  asScript();
  const env = google();
  g.bridgeSetup();
  const key = env.props.BRIDGE_KEY;
  assert.match(key, /^[0-9a-f]{64}$/);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  assert.ok(env.logs[0].includes(hash));
  assert.ok(!env.logs[0].includes(key));
  g.bridgeSetup();
  assert.equal(env.props.BRIDGE_KEY, key);
  assert.match(env.logs[1], /already has a key/);
});

test('a web app user who is not an admin cannot run the bridge', () => {
  const t = fresh();
  google();
  assert.throws(() => g.bridgeSetup(), /Only admins can run this/);
  t.as(t.fx.people.admin);
  assert.doesNotThrow(() => g.bridgeSetup());
});

test('each request carries the key; the server\'s refusals are shown as it gave them', () => {
  asScript();
  let reply = { ok: true, data: { site: SITE + '/', counts: { Staff: 3 }, state: {} } };
  const env = google(() => reply);
  assert.throws(() => g.Bridge.call('bridgeStatus', {}), /no key yet: run bridgeSetup first/);
  env.props.BRIDGE_KEY = 'k'.repeat(64);
  g.bridgeCheck();
  assert.equal(env.sent[0].url, 'https://kttgudordfvhdrkcancp.supabase.co/functions/v1/assessments');
  assert.deepEqual(env.sent[0].body, { action: 'bridgeStatus', key: 'k'.repeat(64) });
  assert.match(env.logs.pop(), /knows the bridge\. The new site: https:\/\/calendar\.school\.example\//);

  env.props.BRIDGE_URL = 'https://elsewhere.example/assessments';
  reply = { ok: false, error: { message: 'Not allowed.' } };
  assert.throws(() => g.bridgeCheck(), /^Error: Not allowed\.$/);
  assert.equal(env.sent[1].url, 'https://elsewhere.example/assessments');
  reply = '<html>Bad gateway</html>';
  assert.throws(() => g.bridgeCheck(), /The server answered 502: <html>Bad gateway/);
});

test('the Sheet is copied tab by tab, its cells as the old app read them', () => {
  const t = asScript();
  const env = google((body) => ({ ok: true, data: body.last ? { counts: { done: true } } : {} }));
  env.props.BRIDGE_KEY = 'k'.repeat(64);
  g.bridgeCopySheet();
  const tables = env.sent.map((s) => s.body.table);
  assert.deepEqual([...new Set(tables)], g.Bridge.TABS);
  assert.equal(env.sent.filter((s) => s.body.last).length, 1);
  assert.equal(env.sent[env.sent.length - 1].body.last, true);
  const staff = env.sent.find((s) => s.body.table === 'Staff').body.rows;
  assert.equal(staff.length, t.backend.objects('Staff').length);
  assert.deepEqual(Object.keys(staff[0]), g.Store.SCHEMAS.Staff);
  assert.match(env.logs.pop(), /It now holds: \{"done":true\}/);

  const c = g.Bridge.cellText;
  assert.equal(c(new Date(2026, 9, 27)), '2026-10-27');
  assert.equal(c(new Date(2026, 9, 27, 9, 45, 5)), '2026-10-27T09:45:05');
  assert.equal(c(new Date(1899, 11, 30, 9, 45)), '09:45');
  assert.equal(c(true), 'TRUE');
  assert.equal(c(null), '');
  assert.equal(c(12), '12');
});

test('copies on the grade calendars are brought in line with the plan, as Mirror.sync did', () => {
  const t = fresh();
  const spec = { title: 'Summative: Biology 9 – Cells', description: '', allDay: true, date: '2026-10-27' };
  const old9 = t.svc.calendarUpsert('grade9@fake', '', spec);
  const old10 = t.svc.calendarUpsert('grade10@fake', '', spec);
  const res = g.Bridge.reconcile({
    id: 'a1', seq: 4,
    plan: {
      have: { 9: { id: old9, cal: 'grade9@fake' }, 10: { id: old10, cal: 'grade10@fake' } },
      want: [{ grade: '9', cal: 'grade9@fake', spec: Object.assign({}, spec, { date: '2026-10-28' }) },
        { grade: '11', cal: 'grade11@fake', spec }],
      calendars: {}
    }
  });
  assert.equal(res.status, 'OK');
  assert.equal(res.mirror['9'].id, old9);
  assert.equal(t.svc.events('grade9@fake').find((e) => e.id === old9).startDate, '2026-10-28');
  assert.equal(res.mirror['10'], undefined);
  assert.equal(t.svc.events('grade10@fake').some((e) => e.id === old10), false);
  assert.ok(t.svc.events('grade11@fake').some((e) => e.id === res.mirror['11'].id));

  const lost = g.Bridge.reconcile({ id: 'a2', seq: 1, plan: { have: {}, want: [{ grade: '9', cal: 'gone@fake', spec }], calendars: {} } });
  assert.match(lost.status, /^ERROR Grade 9: The script cannot open calendar gone@fake/);
  assert.deepEqual(lost.mirror, {});
});

test('emails are sent and old events deleted as the server asks, each failure reported', () => {
  const t = fresh();
  const ev = t.svc.calendarUpsert('grade9@fake', '', { title: 'Old', allDay: true, date: '2026-10-27' });
  const report = g.Bridge.work({
    outbox: [
      { id: 1, kind: 'mail', payload: { to: t.fx.people.slt, subject: 'Request', body: 'Please approve.' } },
      { id: 2, kind: 'delete_event', payload: { cal: 'grade9@fake', id: ev } },
      { id: 3, kind: 'delete_event', payload: { cal: 'gone@fake', id: 'x' } }
    ]
  });
  assert.deepEqual(report.outbox.map((o) => [o.id, !!o.error]), [[1, false], [2, false], [3, true]]);
  assert.equal(t.svc.state.mail.pop().to, t.fx.people.slt);
  assert.equal(t.svc.events('grade9@fake').some((e) => e.id === ev), false);
});

test('the Internal Calendar and the grade calendars are read when the server asks', () => {
  const t = fresh();
  const internal = t.fx.calendars[0];
  const report = g.Bridge.read({
    read: {
      internal: { name: internal.name, from: '2026-10-01', to: '2026-11-01' },
      grades: { mode: 'since', from: '2026-10-01', to: '2026-11-01', calendars: [{ cal: 'grade9@fake' }, { cal: 'gone@fake' }] }
    }
  });
  assert.equal(report.internal.id, internal.id);
  assert.ok(report.internal.events.length > 0);
  assert.ok(Array.isArray(report.grades.calendars['grade9@fake'].events));
  assert.match(report.grades.calendars['gone@fake'].error, /cannot open calendar/);
  const missing = g.Bridge.read({ read: { internal: { name: 'No such calendar' } } });
  assert.match(missing.internal.error, /Cannot find the Internal Calendar \("No such calendar"\)/);
});

test('the switch: MOVED_TO, a last copy, the server told, and bridgeRun every minute instead of the hourly sync', () => {
  asScript();
  const env = google((body) => ({ ok: true, data: body.action === 'bridgeStatus' ? { site: SITE + '/' } : {} }));
  env.props.BRIDGE_KEY = 'k'.repeat(64);
  g.bridgeSwitch();
  assert.equal(env.props.MOVED_TO, SITE);
  const actions = env.sent.map((s) => s.body.action);
  assert.equal(actions[0], 'bridgeStatus');
  assert.ok(actions.includes('bridgeCopy'));
  assert.equal(actions[actions.length - 1], 'bridgeSwitch');
  assert.deepEqual(env.triggers, [{ f: 'bridgeRun', every: 1 }]);
  assert.match(env.logs.pop(), /^Switched\. Old links now open https:\/\/calendar\.school\.example\./);
});

test('no switch while the server does not know the new site\'s address', () => {
  asScript();
  const env = google(() => ({ ok: true, data: { site: '' } }));
  env.props.BRIDGE_KEY = 'k'.repeat(64);
  assert.throws(() => g.bridgeSwitch(), /does not know its own address/);
  assert.equal(env.props.MOVED_TO, undefined);
  assert.deepEqual(env.triggers, [{ f: 'cronHourly' }]);
});
