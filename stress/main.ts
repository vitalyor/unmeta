// Stress-test runner page: works in any browser (desktop, emulators, real phones on the LAN).
// ?set=real|fuzz &run=<name> &from=N &presets=1 &parallel=N
import { inspect, clean, cleanName, PRESETS, CATEGORIES, type Category, type Report } from '../src/engine';
import { limits } from '../src/ui/limits';

const qs = new URLSearchParams(location.search);
const set = qs.get('set') ?? 'real', run = qs.get('run') ?? `run-${navigator.userAgent.includes('Android') ? 'android' : /iPhone|iPad/.test(navigator.userAgent) ? 'ios' : 'desktop'}`;
// explicit ?from wins only on a fresh start; after a watchdog reload we resume from the saved point
const saved = localStorage.getItem(`stress-${run}-${set}`);
const from = Number(saved ?? qs.get('from') ?? 0);
const presets = qs.get('presets') === '1', parallel = Number(qs.get('parallel') ?? 1);
const api = (op: string, i: number | string = '') => `/stress/api/${op}/${set}/${i}?run=${run}`;
const logEl = document.querySelector('#log')!, statEl = document.querySelector('#stat')!;
const log = (s: string) => { logEl.textContent = s + '\n' + (logEl.textContent ?? '').slice(0, 20000); };
const heap = () => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
const post = (op: string, i: number, body: BodyInit) => fetch(api(op, i), { method: 'POST', body });

interface E { i: number; ext: string; size: number; name: string; why?: string }
const entries: E[] = await (await fetch(api('list'))).json();
const stats = { ok: 0, fail: 0, leak: 0, lossy: 0, broken: 0, refused: 0, hang: 0 };

/** Values of tags in removed categories that must not survive anywhere in the output. */
function leakValues(before: Report, after: Report, keep: Category[]): string[] {
  const kept = after.tags.map((t) => t.value).join('\n');
  const vals = CATEGORIES.filter((c) => !keep.includes(c)).flatMap((c) => before.found[c] ?? []).map((t) => t.value.replace(/ \((image|file)\d*\.\w+\)$/, '').trim());
  return [...new Set(vals)].filter((v) => v.length >= 6 && !/^[\d\s:.,+\-/]+$/.test(v) && !kept.includes(v) && v !== '(binary)');
}

async function one(e: E) {
  const t0 = performance.now(), h0 = heap();
  const timeout = (60_000 + (e.size / 2 ** 20) * 300) * Number(qs.get('tmul') ?? 1);
  localStorage.setItem(`stress-${run}-${set}`, String(e.i)); // resume point if the tab dies
  const watchdog = setTimeout(async () => { await post('fail', e.i, JSON.stringify({ status: 'hang', ms: performance.now() - t0 })); localStorage.setItem(`stress-${run}-${set}`, String(e.i + 1)); location.reload(); }, timeout);
  try {
    if (e.size > limits().hard) { stats.refused++; await post('fail', e.i, JSON.stringify({ status: 'refused-too-large', hard: limits().hard })); return; }
    const file = new File([await (await fetch(api('file', e.i))).blob()], e.name);
    const tRead = performance.now();
    const before = await inspect(file);
    if (before.kind === 'unsupported' || before.kind === 'text') {
      stats.refused++;
      const r = before.kind === 'text' ? await clean(file, PRESETS.max, 'file_01').catch((x) => ({ err: String(x) })) : null;
      await post('fail', e.i, JSON.stringify({ status: before.kind, ms: performance.now() - t0 }));
      if (r && 'blob' in r) { await post('meta', e.i, JSON.stringify({ status: 'text', cleanName: r.name, leakValues: [] })); await post('output', e.i, r.blob); }
      return;
    }
    const tInspect = performance.now();
    const r = await clean(file, PRESETS.max, 'file_01');
    const tClean = performance.now();
    const m = {
      status: 'ok', kind: before.kind, cleanName: r.name, notes: r.notes,
      before: Object.keys(before.found), after: Object.keys(r.after.found),
      ms: { fetch: tRead - t0, inspect: tInspect - tRead, clean: tClean - tInspect }, heapMB: Math.round((heap() - h0) / 2 ** 20), heapTotalMB: Math.round(heap() / 2 ** 20),
      leakValues: leakValues(before, r.after, PRESETS.max),
    } as Record<string, unknown>;
    if (presets) {
      const res: Record<string, unknown> = {};
      for (const [k, keep] of Object.entries({ balanced: PRESETS.balanced, private: PRESETS.private, keepLocation: ['location'] as Category[] })) {
        try { const p = await clean(file, keep, 'file_01'); res[k] = { after: Object.keys(p.after.found), notes: p.notes }; }
        catch (x) { res[k] = { error: String(x).slice(0, 300) }; }
      }
      m.presets = res;
    }
    await post('meta', e.i, JSON.stringify(m));
    const c = await (await post('output', e.i, r.blob)).json();
    stats.ok++;
    if (c.leaks?.length) stats.leak++;
    if (c.lossless === false) stats.lossy++;
    if (c.decodes === false) stats.broken++;
    log(`${e.i} ${e.name} ${Math.round(tClean - t0)}ms ${c.leaks?.length ? 'LEAK ' : ''}${c.lossless === false ? 'LOSSY ' : ''}${c.decodes === false ? 'BROKEN ' : ''}`);
  } catch (x) {
    stats.fail++;
    await post('fail', e.i, JSON.stringify({ status: 'error', error: String(x instanceof Error ? x.message : x).slice(0, 500), ms: performance.now() - t0 }));
    log(`${e.i} ${e.name} ERROR ${String(x).slice(0, 120)}`);
  } finally { clearTimeout(watchdog); (globalThis as { gc?: () => void }).gc?.(); } // --expose-gc: harness Blobs must not pile up
}

const todo = entries.filter((e) => e.i >= from);
for (let k = 0; k < todo.length; k += parallel) {
  await Promise.all(todo.slice(k, k + parallel).map(one));
  statEl.textContent = `${set} ${Math.min(k + parallel, todo.length)}/${todo.length} · ${JSON.stringify(stats)} · heap ${Math.round(heap() / 2 ** 20)} MB`;
}
localStorage.removeItem(`stress-${run}-${set}`);
await fetch(api('summary', 0), { method: 'POST', body: JSON.stringify(stats) });
document.title = 'DONE ' + JSON.stringify(stats);
statEl.textContent = 'DONE ' + statEl.textContent;
void cleanName;
