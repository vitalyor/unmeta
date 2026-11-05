// Smoke check of the mockups' live flow in headless Chrome (no deps, Node ≥ 22).
// Clicks through demo → modes → clean → before/after, batch, large file, lang/theme;
// fails on JS errors or horizontal scroll at 320px. Usage: node design/tools/smoke.mjs
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['a-protocol', 'b-redaction', 'c-vault'];
const port = 9800 + Math.floor(Math.random() * 100);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless', '--disable-gpu', `--remote-debugging-port=${port}`, '--user-data-dir=/tmp/um-smoke-prof', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws, id = 0; const pending = new Map(), errors = [];
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(expr + ' → ' + r.exceptionDetails.exception?.description); return r.result.value; };
const click = (sel) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no ${sel}'); el.click(); return true; })()`);
const until = async (expr, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await js(expr)) return; await sleep(100); } throw new Error('timeout: ' + expr); };

try {
  let url; for (let i = 0; i < 50 && !url; i++) { try { url = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
  ws = new WebSocket(url); await new Promise((r) => (ws.onopen = r));
  ws.onmessage = (e) => { const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' ')); };
  await send('Runtime.enable'); await send('Page.enable');
  for (const dir of DIRS) {
    const base = `file://${join(ROOT, 'mockups', dir + '.html')}`;
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '?lang=ru&theme=light' }); await until('!!window.UM');
    await js('localStorage.clear()');
    await click('[data-action=demo]'); await until('UM.S.screen === "report"');
    await click('[data-mode=balanced]'); assert.equal(await js('document.querySelector(".cat-dates").classList.contains("is-keep")'), true, dir + ': balanced keeps dates');
    await click('[data-mode=privateOnly]'); assert.equal(await js('document.querySelectorAll(".find.is-remove").length'), 2, dir + ': private removes 2');
    await click('[data-mode=maximum]');
    await js('UM.S.modeOpen = true; UM.paint(); true');
    await js('(() => { const i = document.querySelector("input[data-cat=dates]"); i.click(); return true; })()');
    assert.equal(await js('document.querySelector("input[data-cat=dates]").checked'), false, dir + ': dates unchecked');
    assert.equal(await js('UM.S.mode'), 'custom', dir + ': toggling a box switches to custom');
    assert.equal(await js('document.querySelector(".toast").textContent.length > 0'), true, dir + ': toast shown');
    await click('.pane-act .btn-clean'); await until('UM.S.screen === "after"', 5000);
    await click('[data-view=before]'); assert.equal(await js('!!document.querySelector(".s-after.view-before")'), true, dir + ': before view');
    await click('.pane-act .btn-get, .dock .btn-get'); await until('UM.S.saved === true', 2000);
    await js('UM.jump("batch"); true'); await until('!!document.querySelector("[data-action=cleanBatch]")');
    await click('.pane-act [data-action=cleanBatch]'); await until('UM.S.batchPhase === "done"', 5000);
    await js('UM.jump("large"); true'); await until('!!document.querySelector("[data-action=largeTry]")');
    await click('[data-action=largeTry]'); await until('UM.S.large.phase === "done"', 10000);
    await click('[data-action=lang]'); assert.equal(await js('document.documentElement.lang'), 'en', dir + ': lang toggles');
    await click('[data-action=theme]'); assert.equal(await js('document.documentElement.dataset.theme'), 'dark', dir + ': theme toggles');
    // 320px phone: no horizontal scroll on any screen, either language
    await send('Emulation.setDeviceMetricsOverride', { width: 320, height: 640, deviceScaleFactor: 1, mobile: true });
    for (const lang of ['ru', 'en']) for (const s of ['start', 'report', 'modes', 'after', 'batch', 'unsupported', 'large']) {
      await send('Page.navigate', { url: `${base}?screen=${s}&lang=${lang}&still=1` }); await until('!!window.UM');
      await js('document.fonts.ready.then(() => true)');
      const [sw, iw] = await js('[document.documentElement.scrollWidth, innerWidth]');
      assert.ok(sw <= iw, `${dir} ${s} ${lang}: horizontal scroll at 320px (${sw} > ${iw})`);
    }
    console.log('ok', dir);
  }
  assert.deepEqual(errors, [], 'JS errors: ' + errors.join('\n'));
  console.log('all good');
} finally { ws?.close(); chrome.kill(); }
