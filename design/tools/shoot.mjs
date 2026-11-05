// Screenshots of the mockups through Chrome DevTools Protocol (headless Chrome on macOS
// can't make a window narrower than 500px, so we emulate the viewport instead).
// Usage: node design/tools/shoot.mjs [direction ...]      (no deps; Node ≥ 22 for global WebSocket)
// Output: design/screens/<direction>/<screen>-<width>[-dark|-en].png
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DIRS = process.argv.slice(2).length ? process.argv.slice(2) : ['a-protocol', 'b-redaction', 'c-vault', 'd-merged', 'e-photo'];
const WIDTHS = { 375: 812, 768: 1024, 1440: 900, 2560: 1440 };
// [file name, query]
const SHOTS = [
  ['start', 'screen=start'], ['report', 'screen=report'], ['modes', 'screen=modes'],
  ['after', 'screen=after'], ['before', 'screen=after&view=before'],
  ['batch', 'screen=batch'], ['batch-done', 'screen=batch&phase=done'],
  ['unsupported', 'screen=unsupported'], ['large', 'screen=large'], ['large-progress', 'screen=largeProgress'],
];
const EXTRA = [['start', 'screen=start', 'dark'], ['report', 'screen=report', 'dark'], ['after', 'screen=after', 'dark'], ['start', 'screen=start', 'en']];

const port = 9333 + Math.floor(Math.random() * 400);
const chrome = spawn(CHROME, ['--headless', '--disable-gpu', '--hide-scrollbars', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/um-cdp-prof', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let ws, id = 0; const pending = new Map(), waiters = [];
async function connect() {
  for (let i = 0; i < 50; i++) {
    try { const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = list.find((t) => t.type === 'page'); if (p) return p.webSocketDebuggerUrl; } catch {}
    await sleep(200);
  }
  throw new Error('chrome did not start');
}
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const once = (method) => new Promise((res) => waiters.push({ method, res }));

try {
  ws = new WebSocket(await connect());
  await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id && pending.has(msg.id)) { const p = pending.get(msg.id); pending.delete(msg.id); msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result); }
    else if (msg.method) for (const w of waiters.splice(0)) (w.method === msg.method ? w.res(msg) : waiters.push(w));
  };
  await send('Page.enable');
  for (const dir of DIRS) {
    mkdirSync(join(ROOT, 'screens', dir), { recursive: true });
    const MORE = dir === 'e-photo' ? [['clean', 'screen=clean'], ['plain', 'screen=plain'], ['error', 'screen=error'], ['too-large', 'screen=tooLarge'], ['loading', 'screen=loading'],
      ['report-long', 'screen=report&long=1'], ['after-long', 'screen=after&long=1'], ['start-long', 'screen=start&long=1']].map(([n, q]) => [n, q, 'light']) : [];
    const jobs = dir === 'icons' ? [['compare', 'x=1', 'light']] : [...SHOTS.map(([n, q]) => [n, q, 'light']), ...EXTRA, ...MORE];
    for (const [name, q, variant] of jobs) for (const [w, h] of Object.entries(WIDTHS)) {
      if (variant !== 'light' && w === '2560') continue;
      if (dir === 'icons' && !['375', '1440'].includes(w)) continue;
      const width = +w, mobile = width < 768;
      await send('Emulation.setDeviceMetricsOverride', { width, height: h, deviceScaleFactor: 1, mobile });
      await send('Emulation.setTouchEmulationEnabled', { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
      const theme = variant === 'dark' ? 'dark' : 'light', lang = variant === 'en' ? 'en' : 'ru';
      const url = `file://${join(ROOT, 'mockups', dir + '.html')}?${q}&theme=${theme}&lang=${lang}&ui=0&still=1`;
      const loaded = once('Page.loadEventFired');
      await send('Page.navigate', { url });
      await loaded;
      await send('Runtime.evaluate', { expression: 'document.fonts.ready.then(() => new Promise(r => setTimeout(r, 350)))', awaitPromise: true });
      const { result } = await send('Runtime.evaluate', { expression: 'Math.min(document.documentElement.scrollHeight, ' + h * 3 + ')', returnByValue: true });
      const fullH = Math.max(h, result.value);
      // Grow the viewport to the full page so the sticky mobile dock sits at the real bottom.
      if (fullH > h) { await send('Emulation.setDeviceMetricsOverride', { width, height: fullH, deviceScaleFactor: 1, mobile }); await sleep(150); }
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width, height: fullH, scale: 1 } });
      const suf = variant === 'light' ? '' : '-' + variant;
      writeFileSync(join(ROOT, 'screens', dir, `${name}-${w}${suf}.png`), Buffer.from(shot.data, 'base64'));
    }
    console.log(dir, 'done');
  }
} finally { ws?.close(); chrome.kill(); }
