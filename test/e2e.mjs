// End-to-end like a person: node test/e2e.mjs <url> [chromium|webkit] [mobile]
// start → sample → clean → download → batch upload (photo, video, audio, pdf, docx, txt, unknown) → clean all → zip.
// Fails on any page error, console error or CSP violation.
import { chromium, webkit, devices } from 'playwright';
import { fileURLToPath } from 'node:url';

const [url = 'http://localhost:4173/', engine = 'chromium', mode = ''] = process.argv.slice(2);
const FX = fileURLToPath(new URL('./fixtures/', import.meta.url));
const browser = await ({ chromium, webkit })[engine].launch();
const ctx = await browser.newContext({ ...(mode === 'mobile' ? devices['iPhone 13'] : {}), acceptDownloads: true, locale: 'ru-RU' });
const page = await ctx.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
await page.addInitScript(() => {
  localStorage.setItem('um-lang', 'ru');
  document.addEventListener('securitypolicyviolation', (e) => console.error(`CSP blocked ${e.blockedURI} (${e.violatedDirective})`));
});
const step = async (name, fn) => {
  const t = Date.now();
  try { await fn(); } catch (e) { console.log(`✗ ${name}: ${String(e.message).split('\n')[0]}\nPROBLEMS:\n${problems.join('\n') || '-'}`); await browser.close(); process.exit(1); }
  console.log(`✓ ${name} (${Date.now() - t} ms)`);
};
const T = 120_000;

await step('open', async () => { await page.goto(url); await page.getByRole('heading', { level: 1 }).waitFor(); });
await step('sample → report', async () => {
  await page.getByRole('button', { name: 'Попробовать на примере' }).click();
  await page.getByRole('heading', { name: 'Что нашли' }).waitFor({ timeout: T });
});
await step('choose another file (cancel) → start → sample again', async () => {
  await page.getByRole('button', { name: 'Выбрать другой файл' }).first().click();
  await page.getByRole('button', { name: 'Попробовать на примере' }).waitFor();
  await page.getByRole('button', { name: 'Попробовать на примере' }).click();
  await page.getByRole('heading', { name: 'Что нашли' }).waitFor({ timeout: T });
});
await step('clean → done', async () => {
  await page.locator('.btn-clean:visible').first().click();
  await page.getByRole('heading', { name: 'Готово' }).waitFor({ timeout: T });
});
if (mode !== 'mobile') await step('download', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.btn-get:visible').first().click()]);
  if (!/_clean\.jpg$/i.test(dl.suggestedFilename())) throw new Error('bad name ' + dl.suggestedFilename());
});
await step('batch upload → report', async () => {
  await page.locator('.brand').click();
  await page.getByRole('heading', { level: 1 }).waitFor();
  const files = ['photo.jpg', 'photo-big.png', 'photo.heic', 'video.mp4', 'video.mov', 'audio.mp3', 'doc.pdf', 'doc.docx', 'notes.txt', 'scene.blend'].map((f) => FX + f);
  await page.locator('input[type=file]:not([accept])').setInputFiles(files);
  await page.locator('.s-batch .btn-clean:visible').first().waitFor({ timeout: T });
  await page.waitForFunction(() => !document.querySelector('.s-batch .btn-clean:not(:disabled)')?.textContent?.includes('Смотрим'), null, { timeout: T });
  await page.locator('.s-batch .btn-clean:visible:not(:disabled)').first().waitFor({ timeout: T });
});
await step('remove one file from the batch', async () => {
  const before = await page.locator('.tile').count();
  await page.getByRole('button', { name: /Убрать scene\.blend/ }).click();
  await page.waitForFunction((n) => document.querySelectorAll('.tile').length === n - 1, before);
});
await step('clean all', async () => {
  await page.locator('.s-batch .btn-clean:visible:not(:disabled)').first().click();
  await page.getByRole('heading', { name: 'Готово' }).waitFor({ timeout: T });
  const done = await page.locator('.tile-st.ok').count();
  if (done !== 8) throw new Error(`expected 8 cleaned tiles, got ${done}`); // 10 files − txt − removed unknown
});
if (mode !== 'mobile') await step('download all (zip)', async () => {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('.btn-all:visible').first().click()]);
  if (!dl.suggestedFilename().endsWith('.zip')) throw new Error('bad zip ' + dl.suggestedFilename());
});

await browser.close();
if (problems.length) { console.log('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
console.log(`ALL GOOD · ${engine}${mode ? ' ' + mode : ''} · ${url}`);
