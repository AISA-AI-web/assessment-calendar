/**
 * Loads the real Apps Script files into Node, with the in-memory Sheet and the
 * fake Google services from support/. Each test calls fresh() for a clean
 * school, then talks to the server exactly as the browser would.
 *
 * Run with TZ=Asia/Dubai (npm test does this) so local dates match the app.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const SERVER_FILES = ['Util', 'Config', 'Store', 'Svc', 'Days', 'Directory', 'Import', 'Rules', 'Entries', 'Mirror', 'Api', 'WebApp', 'Bridge'];
const SUPPORT_FILES = ['memory_backend', 'fake_services', 'fixtures'];

let loaded = false;

function load() {
  if (loaded) return globalThis;
  for (const f of SERVER_FILES) {
    const file = path.join(ROOT, 'apps_script', f + '.gs');
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  for (const f of SUPPORT_FILES) {
    const file = path.join(ROOT, 'support', f + '.js');
    vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: file });
  }
  loaded = true;
  return globalThis;
}

/**
 * A fresh school. opts.user signs someone in; opts.tables overrides fixture tables;
 * opts.sync (default true) copies the fake Internal Calendar into InternalEvents.
 */
function fresh(opts) {
  opts = opts || {};
  const g = load();
  const fx = g.Fixtures.build();
  const tables = Object.assign({}, fx.tables, opts.tables || {});
  const backend = g.MemoryBackend.fromObjects(g.Store.SCHEMAS, tables);
  const svc = g.FakeServices({ user: opts.user || fx.people.teacher, today: opts.today || fx.today });
  fx.calendars.forEach((c) => svc.addCalendar(c.id, c.name, c.events));
  g.Svc = svc;
  g.Store.setBackend(backend);
  resetCaches(g);
  if (opts.sync !== false) {
    g.Days.sync();
    resetCaches(g);
  }
  return { g, fx, backend, svc, as: (email) => { svc.state.user = email; resetCaches(g); } };
}

function resetCaches(g) {
  g.Store.invalidate();
  g.Config.reset();
  g.Dir.reset();
  g.Days.reset();
  g.Entries.reset();
}

/** Calls an api* function and returns its envelope as plain JSON. */
function call(g, name, arg) {
  resetCaches(g);
  return JSON.parse(JSON.stringify(g[name](arg)));
}

module.exports = { load, fresh, call, resetCaches };
