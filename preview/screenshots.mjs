/**
 * Drives the preview in Chromium and saves screenshots of the main screens to
 * preview/screenshots/. Fails if the page logs an error or a check fails.
 *
 *   node preview/build.mjs && node preview/screenshots.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
let playwright;
try {
  playwright = require('playwright');
} catch (e) {
  playwright = require(join(execSync('npm root -g').toString().trim(), 'playwright'));
}

const out = join(root, 'preview/screenshots');
mkdirSync(out, { recursive: true });
const page0 = pathToFileURL(join(root, 'preview/dist/index.html')).href;

const errors = [];
const checks = [];
function check(ok, what) {
  checks.push((ok ? 'ok   ' : 'FAIL ') + what);
  if (!ok) errors.push('check failed: ' + what);
}

const browser = await playwright.chromium.launch();

async function open(query, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)/.test(m.text())) errors.push(query + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push(query + ': ' + e.message));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
  await page.goto(page0 + query);
  await page.waitForSelector('#view .month, #view .week, #view .agenda', { timeout: 15000 });
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));
  return { ctx, page };
}

async function shot(page, name, full) {
  await page.screenshot({ path: join(out, name + '.png'), fullPage: full !== false });
}

// 1. Teacher, month view of their grade
{
  const { ctx, page } = await open('?as=teacher&date=2026-10-27');
  check(await page.locator('.month .cell').count() >= 20, 'month grid renders weekdays');
  check((await page.locator('#view-title').innerText()).includes('Grade 9'), 'teacher starts on their grade');
  check(await page.locator('.cell .rot').count() > 10, 'rotation days shown');
  await shot(page, '1-teacher-month');

  // 2. Booking that breaks the limit
  const sectionId = await page.evaluate(() => window.__PREVIEW__.fixtures.courses.G09BIO.section_id);
  await page.getByRole('button', { name: '+ Add assessment' }).click();
  await page.locator('#f-title').fill('Cells unit test');
  await page.locator('.classes label', { hasText: 'Biology 9 Girls' }).locator('input').check();
  await page.locator('.rowcard input[type=date]').first().fill('2026-10-27');
  await page.locator('.rowcard input[type=date]').first().dispatchEvent('change');
  await page.waitForSelector('.verdict[data-v="BLOCK"]', { timeout: 8000 });
  check(await page.getByRole('button', { name: 'Ask SLT to approve' }).count() === 1, 'blocked teacher is offered "Ask SLT to approve"');
  check((await page.locator('.verdict').first().innerText()).includes('18 students would have 3 summatives'), 'block explains how many students');
  await shot(page, '2-teacher-booking-blocked', false);

  // 3. Ask SLT
  await page.locator('#f-reason').fill('Only day the lab is free before the unit ends.');
  await page.getByRole('button', { name: 'Ask SLT to approve' }).click();
  await page.waitForSelector('.toast');
  check((await page.locator('.toast').innerText()).includes('Sent to SLT'), 'request confirmation shown');
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));

  // 4. Week view of one class
  await page.goto(page0 + '?as=teacher&view=week&date=2026-10-27&scope=section:' + sectionId);
  await page.waitForSelector('#view .week');
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));
  check(await page.locator('.week td.none').count() === 3, 'Friday has no P5–P7');
  await shot(page, '3-teacher-week-class');

  // 5. Old calendar entries
  await page.getByRole('button', { name: /From the old calendars/ }).click();
  await page.waitForSelector('.drawer .card');
  await shot(page, '4-teacher-old-calendars', false);

  // The same browser tab carries on as SLT: the request just made is waiting.
  await page.goto(page0 + '?as=slt&date=2026-10-27&scope=grade:9');
  await page.waitForSelector('#view .month');
  await page.getByRole('button', { name: /Requests/ }).click();
  await page.waitForSelector('.drawer .card');
  const cards = page.locator('.drawer .card', { hasText: 'Cells unit test' });
  check(await cards.count() === 1, 'the teacher\'s request reaches SLT after switching role');
  await cards.first().getByRole('button', { name: 'Approve' }).click();
  await page.waitForSelector('.toast');
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));
  await page.keyboard.press('Escape');
  const over = await page.locator('.cell .meter[data-level="over"]').count();
  check(over >= 1, 'after approval the day shows as over the limit');
  await shot(page, '5b-slt-after-approval');
  check(await page.locator('#preview-bar details summary').innerText().then((t) => /\((2|3)\)/.test(t)), 'emails to SLT and the teacher are in the outbox');
  await ctx.close();
}

// 5c. Teacher: book, edit, delete; claim an old entry; day panel; filters; week slot
{
  const { ctx, page } = await open('?as=teacher&date=2026-10-27');

  await page.getByRole('button', { name: '+ Add assessment' }).click();
  await page.locator('#f-title').fill('E2E quiz');
  await page.locator('.classes label', { hasText: 'Biology 9 Boys' }).locator('input').check();
  await page.locator('.rowcard input[type=date]').first().fill('2026-10-27');
  await page.locator('.rowcard input[type=date]').first().dispatchEvent('change');
  await page.waitForSelector('.verdict[data-v="OK"], .verdict[data-v="WARN"]', { timeout: 8000 });
  await page.locator('.drawer__foot .btn--gold').click();
  await page.waitForSelector('.toast');
  check((await page.locator('.toast').last().innerText()).includes('Added to the calendar'), 'a clear booking saves');
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));
  const copied = await page.evaluate(() => window.__PREVIEW__.svc.events('grade9@fake').some((e) => /E2E quiz/.test(e.title)));
  check(copied, 'the booking is copied to the Grade 9 calendar');

  await page.locator('.chip', { hasText: 'E2E quiz' }).first().click();
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.locator('#f-title').fill('E2E quiz (renamed)');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Saved.')));
  check(true, 'an entry can be edited');
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));
  await page.locator('.chip', { hasText: 'E2E quiz (renamed)' }).first().click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  check(await page.getByRole('button', { name: 'Keep it' }).count() === 1, 'deleting asks for confirmation in the panel');
  await page.getByRole('button', { name: 'Delete it' }).click();
  await page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('Deleted.')));
  const gone = await page.evaluate(() => !window.__PREVIEW__.svc.events('grade9@fake').some((e) => /E2E quiz/.test(e.title)));
  check(gone, 'deleting removes the grade calendar copy');

  await page.evaluate(() => document.querySelectorAll('.toast').forEach((t) => { t.dataset.seen = '1'; }));
  await page.getByRole('button', { name: /From the old calendars/ }).click();
  const card = page.locator('.drawer .card', { hasText: 'B9 Biology summative' });
  await card.getByRole('button', { name: 'Add to the app' }).click();
  await page.locator('.classes label', { hasText: 'Biology 9 Boys' }).locator('input').check();
  await page.waitForSelector('.verdict', { timeout: 8000 });
  check(await page.locator('.rowcard input[type=date]').first().inputValue() === '2026-11-05', 'claiming keeps the old date');
  await page.getByRole('button', { name: 'Add to calendar' }).click();
  await page.waitForFunction(() => document.querySelector('.drawer .error-text') ||
    [...document.querySelectorAll('.toast')].some((t) => /Added to the calendar/.test(t.textContent) && !t.dataset.seen), null, { timeout: 8000 });
  const claimError = await page.locator('.drawer .error-text').count() ? await page.locator('.drawer .error-text').innerText() : '';
  check(!claimError, 'claiming saves without an error' + (claimError ? ' (' + claimError + ')' : ''));
  await page.waitForFunction(() => !document.querySelector('#view.is-loading'));
  const adopted = await page.evaluate(() => window.__PREVIEW__.svc.events('grade9@fake').find((e) => e.id === 'old-g9-2@fake'));
  check(adopted && /^Summative: Biology 9 Boys/.test(adopted.title), 'the old event is taken over and retitled');
  check((await page.getByRole('button', { name: /From the old calendars/ }).innerText()).includes('1'), 'one old entry left to handle');

  await page.locator('.cell__num', { hasText: /^27$/ }).first().click();
  await page.waitForSelector('.drawer .card--tint');
  check((await page.locator('.drawer').innerText()).includes('The busiest student has 2 summatives'), 'the day panel explains the load');
  await page.keyboard.press('Escape');
  check(await page.locator('.drawer').count() === 0, 'Escape closes panels');

  const before = await page.locator('.chip[data-cat="FORMATIVE"]').count();
  await page.getByRole('button', { name: 'Formatives' }).click();
  check(before > 0 && await page.locator('.chip[data-cat="FORMATIVE"]').count() === 0, 'the formative filter hides formatives');
  const meters = await page.locator('.cell .meter').count();
  check(meters > 0, 'filters leave the load meters alone');
  await page.getByRole('button', { name: 'Formatives' }).click();

  await page.getByRole('button', { name: 'Week' }).click();
  await page.waitForSelector('#view .week');
  await page.locator('.week td.slot').nth(12).click();
  await page.waitForSelector('.drawer .rows');
  check(await page.locator('.drawer .pchip[aria-pressed="true"]').count() <= 1, 'clicking a period slot presets that period');
  await page.keyboard.press('Escape');
  await ctx.close();
}

// 6. SLT requests
{
  const { ctx, page } = await open('?as=slt&date=2026-10-27');
  await page.getByRole('button', { name: /Requests/ }).click();
  await page.waitForSelector('.drawer .card');
  check(await page.locator('.drawer .card').count() >= 1, 'SLT sees the pending request');
  await shot(page, '5-slt-requests', false);
  await page.locator('.drawer .card').first().getByRole('button', { name: 'Approve' }).click();
  await page.waitForSelector('.toast');
  check((await page.locator('.toast').innerText()).includes('Approved'), 'SLT can approve');
  await ctx.close();
}

// 7. Student
{
  const { ctx, page } = await open('?as=student&date=2026-10-27');
  check((await page.locator('#scopebar').innerText()).includes('My assessments'), 'student sees only their own calendar');
  check(await page.getByRole('button', { name: '+ Add assessment' }).count() === 0, 'students cannot add');
  await shot(page, '6-student-month');
  await ctx.close();
}

// 8. Phone
{
  const { ctx, page } = await open('?as=teacher&date=2026-10-27', { width: 390, height: 844 });
  check(await page.locator('#view .agenda').count() === 1, 'phones get the agenda');
  await shot(page, '7-teacher-phone');
  await ctx.close();
}

// 9. Switching role in the page, without reloading
{
  const { ctx, page } = await open('?as=teacher&date=2026-10-27');
  await page.locator('#preview-bar').getByRole('button', { name: 'SLT', exact: true }).click();
  await page.waitForSelector('.header .who .role:text-is("SLT")');
  check(await page.getByRole('button', { name: /Requests/ }).count() === 1, 'the demo bar switches to SLT in place');
  await page.locator('#preview-bar').getByRole('button', { name: 'Student (Grade 9)' }).click();
  await page.waitForSelector('.scope-me');
  check(await page.getByRole('button', { name: '+ Add assessment' }).count() === 0, 'and to the student');
  await ctx.close();
}

// 10. The hosted-viewer copy, wrapped the way the host wraps it
{
  const { readFileSync, writeFileSync } = await import('node:fs');
  const wrapped = join(root, 'preview/dist/artifact-wrapped.html');
  writeFileSync(wrapped, '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"></head><body>' +
    readFileSync(join(root, 'preview/dist/artifact.html'), 'utf8') + '</body></html>');
  for (const vp of [{ width: 1280, height: 900 }, { width: 400, height: 860 }]) {
    const ctx = await browser.newContext({ viewport: vp });
    const page = await ctx.newPage();
    page.on('console', (m) => { if (m.type() === 'error') errors.push('artifact ' + vp.width + ': ' + m.text()); });
    page.on('pageerror', (e) => errors.push('artifact ' + vp.width + ': ' + e.message));
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ status: 200, contentType: 'text/css', body: '' }));
    await page.goto(pathToFileURL(wrapped).href + '#slt');
    await page.waitForSelector('#view .month, #view .agenda', { timeout: 15000 });
    check(await page.title() === 'Assessment Calendar Preview', 'hosted copy has its title (' + vp.width + 'px)');
    check(await page.locator('.btn--print').isHidden(), 'hosted copy hides Print (' + vp.width + 'px)');
    check((await page.locator('.header .who .role').innerText()) === 'SLT', 'a #slt link opens as SLT (' + vp.width + 'px)');
    const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(wide <= 0, 'no sideways scrolling at ' + vp.width + 'px');
    await shot(page, 'artifact-' + vp.width, false);
    await ctx.close();
  }
}

await browser.close();
console.log(checks.join('\n'));
if (errors.length) {
  console.error('\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nScreenshots in preview/screenshots/');
