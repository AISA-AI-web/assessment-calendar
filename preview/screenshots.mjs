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

await browser.close();
console.log(checks.join('\n'));
if (errors.length) {
  console.error('\n' + errors.join('\n'));
  process.exit(1);
}
console.log('\nScreenshots in preview/screenshots/');
