/**
 * The preview's stand-in for Google. Not part of the deployed app.
 *
 * Runs the real server code (apps_script/*.gs) in the browser against an
 * in-memory Sheet and the fictional school from support/fixtures.js, answers
 * the page's google.script.run calls, and adds a demo bar for switching who is
 * signed in. Changes last for the browser tab (sessionStorage), so a demo can
 * book as a teacher, approve as SLT and then look as a student.
 *
 * The starting role comes from ?as=… (local file) or #… (shared link):
 * teacher, slt, admin, student or viewer.
 */
(function () {
  'use strict';

  var ROLES = [
    ['teacher', 'Teacher'],
    ['slt', 'SLT'],
    ['admin', 'Admin'],
    ['student', 'Student (Grade 9)'],
    ['viewer', 'Counsellor (view only)']
  ];

  function initialRole() {
    var pick = '';
    try { pick = new URLSearchParams(window.location.search).get('as') || ''; } catch (e) { pick = ''; }
    if (!pick) pick = (window.location.hash || '').replace(/^#/, '');
    return ROLES.some(function (r) { return r[0] === pick; }) ? pick : 'teacher';
  }

  var who = initialRole();
  var fx = Fixtures.build();
  var backend = MemoryBackend.fromObjects(Store.SCHEMAS, fx.tables);
  var svc = FakeServices({ user: fx.people[who], today: fx.today });
  window.Svc = svc;
  Store.setBackend(backend);

  var KEY = 'ac-preview2:' + fx.today + ':' + fx.tables.Assessments.length;

  function resetCaches() {
    Store.invalidate();
    Config.reset();
    Dir.reset();
    Days.reset();
    Entries.reset();
  }

  function seed() {
    var fresh = Fixtures.build();
    backend.db = MemoryBackend.fromObjects(Store.SCHEMAS, fresh.tables).db;
    svc.state.calendars = {};
    svc.state.mail = [];
    fresh.calendars.forEach(function (c) { svc.addCalendar(c.id, c.name, c.events); });
    resetCaches();
    Days.sync();
    resetCaches();
    // What teachers had already put on the grade calendars, brought in as menu step 4 does.
    Mirror.importExisting();
    resetCaches();
  }

  function restore() {
    var saved = null;
    try { saved = JSON.parse(window.sessionStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || !saved.db) return false;
    backend.db = saved.db;
    svc.state.calendars = saved.calendars;
    svc.state.mail = saved.mail || [];
    svc.state.seq = saved.seq || 0;
    return true;
  }

  function persist() {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({
        db: backend.db, calendars: svc.state.calendars, mail: svc.state.mail, seq: svc.state.seq
      }));
    } catch (e) { /* storage blocked or full: the demo just won't survive a reload */ }
  }

  if (!restore()) seed();
  persist();

  window.__PREVIEW__ = { fixtures: fx, backend: backend, svc: svc };

  /** What google.script.run does in the real app: call a server function, get JSON back. */
  window.__PREVIEW_SERVER__ = function (name, arg) {
    return new Promise(function (resolve) {
      window.setTimeout(function () {
        resetCaches();
        var fn = window[name];
        var res = typeof fn === 'function'
          ? fn(arg === undefined ? undefined : JSON.parse(JSON.stringify(arg)))
          : { ok: false, error: { code: 'NO_SUCH_FUNCTION', message: name } };
        persist();
        renderOutbox();
        resolve(JSON.parse(JSON.stringify(res)));
      }, 90);
    });
  };

  /* ---------------- the demo bar ---------------- */

  var css = document.createElement('style');
  css.textContent = [
    '#preview-bar{font:500 13px/1.45 "DM Sans",system-ui,sans-serif;background:#1A1A1A;color:#F2EFFA;',
    'padding:10px 16px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;border-bottom:3px solid #D8B664}',
    '#preview-bar .pv-tag{background:#D8B664;color:#21076C;font-weight:700;padding:2px 8px;border-radius:4px}',
    '#preview-bar .pv-group{display:flex;flex-wrap:wrap;gap:6px;align-items:center}',
    '#preview-bar button{font:inherit;background:#2B2B2B;color:#F2EFFA;border:1px solid #555555;border-radius:4px;',
    'padding:4px 10px;min-height:32px;cursor:pointer}',
    '#preview-bar button[aria-pressed="true"]{background:#D8B664;color:#21076C;border-color:#D8B664;font-weight:700}',
    '#preview-bar button:focus-visible{outline:2px solid #D8B664;outline-offset:2px}',
    '#preview-bar .pv-note{flex-basis:100%;color:#C8BEE8;font-size:12px}',
    '#preview-bar details{flex-basis:100%}',
    '#preview-bar summary{cursor:pointer;color:#D8B664}',
    '#preview-bar pre{white-space:pre-wrap;background:#2B2B2B;color:#F2EFFA;padding:8px;border-radius:4px;margin:6px 0;',
    'font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}'
  ].join('');
  document.head.appendChild(css);

  var bar = document.createElement('div');
  bar.id = 'preview-bar';
  var outbox = document.createElement('details');

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function restartApp() {
    if (window.AC && window.AC.restart) window.AC.restart();
  }

  function switchTo(role) {
    who = role;
    svc.state.user = fx.people[role];
    renderBar();
    restartApp();
  }

  function renderOutbox() {
    var mail = svc.state.mail;
    outbox.hidden = !mail.length;
    outbox.textContent = '';
    outbox.appendChild(el('summary', null, 'Emails the app would have sent (' + mail.length + ')'));
    mail.slice().reverse().forEach(function (m) {
      outbox.appendChild(el('pre', null, 'To: ' + m.to + '\nSubject: ' + m.subject + '\n\n' + m.body));
    });
  }

  function renderBar() {
    bar.textContent = '';
    bar.appendChild(el('span', 'pv-tag', 'PREVIEW · fictional school · today is Wed 21 Oct 2026'));
    var group = el('span', 'pv-group');
    group.setAttribute('role', 'group');
    group.setAttribute('aria-label', 'Signed in as');
    group.appendChild(el('span', null, 'Signed in as:'));
    ROLES.forEach(function (r) {
      var b = el('button', null, r[0] === 'teacher' ? 'Teacher (' + fx.people.teacherName + ')' : r[1]);
      b.type = 'button';
      b.setAttribute('aria-pressed', r[0] === who ? 'true' : 'false');
      b.addEventListener('click', function () { switchTo(r[0]); });
      group.appendChild(b);
    });
    bar.appendChild(group);
    var reset = el('button', null, 'Reset demo data');
    reset.type = 'button';
    reset.addEventListener('click', function () {
      seed();
      persist();
      renderOutbox();
      restartApp();
    });
    bar.appendChild(reset);
    bar.appendChild(el('span', 'pv-note',
      'Try it: as the teacher, book a Biology 9 Girls test on Tue 27 Oct and ask SLT to approve it. Then switch to SLT ' +
      'and approve it under Requests, and switch to the student to see what they see. All people and data are invented; ' +
      'nothing is saved or sent.'));
    bar.appendChild(outbox);
    renderOutbox();
  }

  renderBar();
  function mount() { document.body.insertBefore(bar, document.body.firstChild); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
