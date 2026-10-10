/**
 * Builds preview/dist/index.html: the real page (Index.html + Styles.html +
 * App.html) running against the real server code (apps_script/*.gs) in the
 * browser, with the in-memory Sheet and the fictional school from support/.
 * No Google account, no deployment: open the file, or serve the folder.
 *
 *   node preview/build.mjs
 *   open preview/dist/index.html?as=teacher   (teacher | slt | admin | student | viewer)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const SERVER = ['Util', 'Config', 'Store', 'Svc', 'Days', 'Directory', 'Import', 'Rules', 'Entries', 'Mirror', 'Api'];
const SUPPORT = ['memory_backend', 'fake_services', 'fixtures'];

const script = (code, name) => `<script>\n/* ---- ${name} ---- */\n${code.replace(/<\/script/gi, '<\\/script')}\n</script>`;

const runtime = `
(function () {
  'use strict';
  var params = new URLSearchParams(window.location.search);
  var who = params.get('as') || 'teacher';
  var fx = Fixtures.build();
  var email = fx.people[who] || who;
  var backend = MemoryBackend.fromObjects(Store.SCHEMAS, fx.tables);
  var svc = FakeServices({ user: email, today: fx.today });
  fx.calendars.forEach(function (c) { svc.addCalendar(c.id, c.name, c.events); });
  window.Svc = svc;
  Store.setBackend(backend);

  // Changes survive reloads in this tab, so a demo can switch roles mid-story.
  var KEY = 'ac-preview:' + fx.today + ':' + fx.tables.Assessments.length;
  var saved = null;
  try { saved = JSON.parse(window.sessionStorage.getItem(KEY) || 'null'); } catch (e) { saved = null; }
  if (saved && params.get('reset') !== '1') {
    backend.db = saved.db;
    svc.state.calendars = saved.calendars;
    svc.state.mail = saved.mail;
    svc.state.seq = saved.seq;
  } else {
    Days.sync();
  }
  function persist() {
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({ db: backend.db, calendars: svc.state.calendars, mail: svc.state.mail, seq: svc.state.seq }));
    } catch (e) { /* storage full or blocked: the demo just won't survive a reload */ }
  }
  persist();
  function resetCaches() { Store.invalidate(); Config.reset(); Dir.reset(); Days.reset(); Entries.reset(); }
  window.__PREVIEW__ = { fixtures: fx, backend: backend, svc: svc };
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

  var roles = [['teacher', 'Teacher (' + fx.people.teacherName + ')'], ['slt', 'SLT'], ['admin', 'Admin'], ['student', 'Student (Grade 9)'], ['viewer', 'Counsellor (view only)']];
  var bar = document.createElement('div');
  bar.id = 'preview-bar';
  bar.setAttribute('style', 'font:500 13px/1.4 "DM Sans",sans-serif;background:#1A1A1A;color:#F2EFFA;padding:8px 16px;display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;border-bottom:3px solid #D8B664');
  var tag = document.createElement('b');
  tag.textContent = 'PREVIEW · fictional school · today is Wed 21 Oct 2026';
  tag.setAttribute('style', 'background:#D8B664;color:#21076C;padding:2px 8px;border-radius:4px');
  bar.appendChild(tag);
  var label = document.createElement('span');
  label.textContent = 'View as:';
  bar.appendChild(label);
  roles.forEach(function (r) {
    var a = document.createElement('a');
    a.href = '?as=' + r[0];
    a.textContent = r[1];
    a.setAttribute('style', 'color:' + (r[0] === who ? '#D8B664;font-weight:700' : '#F2EFFA'));
    bar.appendChild(a);
  });
  var resetLink = document.createElement('a');
  resetLink.href = '?as=' + who + '&reset=1';
  resetLink.textContent = 'Reset demo data';
  resetLink.setAttribute('style', 'color:#F2EFFA;margin-left:auto');
  bar.appendChild(resetLink);
  var outbox = document.createElement('details');
  outbox.setAttribute('style', 'flex-basis:100%;display:none');
  bar.appendChild(outbox);
  function renderOutbox() {
    var mail = svc.state.mail;
    outbox.style.display = mail.length ? 'block' : 'none';
    outbox.textContent = '';
    var sum = document.createElement('summary');
    sum.textContent = 'Emails the app would have sent (' + mail.length + ')';
    sum.setAttribute('style', 'cursor:pointer;color:#D8B664');
    outbox.appendChild(sum);
    mail.slice().reverse().forEach(function (m) {
      var pre = document.createElement('pre');
      pre.setAttribute('style', 'white-space:pre-wrap;background:#2b2b2b;padding:8px;border-radius:4px;margin:6px 0;font:12px/1.4 ui-monospace,monospace');
      pre.textContent = 'To: ' + m.to + '\\nSubject: ' + m.subject + '\\n\\n' + m.body;
      outbox.appendChild(pre);
    });
  }
  renderOutbox();
  document.addEventListener('DOMContentLoaded', function () { document.body.insertBefore(bar, document.body.firstChild); });
})();
`;

let html = read('apps_script/Index.html');
const replaceOnce = (needle, value) => {
  if (!html.includes(needle)) throw new Error('Index.html is missing ' + needle);
  html = html.replace(needle, () => value);
};
replaceOnce("<?!= include('Styles') ?>", read('apps_script/Styles.html'));
replaceOnce("<?!= typeof bootstrapJson === 'undefined' ? 'null' : bootstrapJson ?>", 'null');
replaceOnce("<?!= typeof paramsJson === 'undefined' ? '{}' : paramsJson ?>", '{}');
const preview = [
  ...SERVER.map((f) => script(read(`apps_script/${f}.gs`), `apps_script/${f}.gs`)),
  ...SUPPORT.map((f) => script(read(`support/${f}.js`), `support/${f}.js`)),
  script(runtime, 'preview runtime')
].join('\n');
replaceOnce("<?!= include('App') ?>", preview + '\n' + read('apps_script/App.html'));
if (/<\?/.test(html)) throw new Error('An Apps Script scriptlet was left in the preview.');

html = html.replace('<head>', '<head>\n<!-- GENERATED by preview/build.mjs. Do not edit; change apps_script/ and support/ instead. -->');
mkdirSync(join(root, 'preview/dist'), { recursive: true });
writeFileSync(join(root, 'preview/dist/index.html'), html);
console.log('Wrote preview/dist/index.html (' + Math.round(html.length / 1024) + ' KB)');
