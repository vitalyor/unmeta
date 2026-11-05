// Headless runner: node stress/run.mjs <chromium|webkit> <set> [extra query]
import { chromium, webkit } from 'playwright';
const [engine = 'chromium', set = 'real', extra = ''] = process.argv.slice(2);
const browser = await ({ chromium, webkit })[engine].launch(engine === 'chromium' ? { args: ['--js-flags=--expose-gc'] } : {});
const page = await (await browser.newContext()).newPage();
// THROTTLE=6 → Chromium CPU slowed 6x (DevTools' "low-end mobile" preset): a budget-Android CPU proxy
if (process.env.THROTTLE && engine === 'chromium') {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(process.env.THROTTLE) });
  console.log('CPU throttle x' + process.env.THROTTLE);
}
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('crash', () => { console.log('PAGE CRASHED'); errors.push('crash'); });
const runName = process.env.RUN ?? engine;
const url = `http://localhost:5180/stress/?set=${set}&run=${runName}&from=0${extra ? '&' + extra : ''}`;
console.log('open', url);
await page.goto(url);
const t0 = Date.now();
let lastStat = '', stuckSince = Date.now();
for (;;) {
  await page.waitForTimeout(15000);
  // a page that shows the same status for 5 minutes is stuck (e.g. server restart): reload, it resumes where it was
  const cur = await page.locator('#stat').textContent().catch(() => '');
  if (cur !== lastStat) { lastStat = cur; stuckSince = Date.now(); }
  else if (Date.now() - stuckSince > 300_000) { console.log('stuck, reloading'); stuckSince = Date.now(); await page.reload().catch(() => {}); continue; }
  let title = ''; try { title = await page.title(); } catch { console.log('page gone, reopening'); await page.goto(url.replace('&from=0', '')); continue; }
  const stat = await page.locator('#stat').textContent().catch(() => '');
  console.log(`[${Math.round((Date.now() - t0) / 1000)}s] ${stat}`);
  if (title.startsWith('DONE')) break;
}
console.log('page errors:', errors.slice(0, 20));
await browser.close();
