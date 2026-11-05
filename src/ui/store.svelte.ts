// App state and actions. Only settings are persisted (mode, custom set, language, theme) — nothing about files.
import { tick } from 'svelte';
import { zipSync } from 'fflate';
import { inspect, clean, kindOf, loadAv, avLoaded, CATEGORIES, type Category, type Kind, type Report, type Cleaned } from '../engine';
import { t } from './i18n.svelte';

export type ModeId = 'maximum' | 'balanced' | 'privateOnly' | 'custom';
// UI modes are "what to REMOVE" (as in the mockups); the engine takes "what to keep".
export const MODE_REMOVE: Record<Exclude<ModeId, 'custom'>, Category[]> = {
  maximum: [...CATEGORIES],
  balanced: ['location', 'device', 'author', 'software', 'thumbnails'],
  privateOnly: ['location', 'device'],
};
export const MODE_ICON: Record<ModeId, string> = { maximum: 'shield', balanced: 'scale', privateOnly: 'private', custom: 'sliders' };

export type ItemStatus = 'reading' | 'ready' | 'nothing' | 'plain' | 'unsupported' | 'big' | 'tooLarge' | 'cleaning' | 'done' | 'error';
export interface Item {
  id: number; file: File; kind: Kind; url: string; video: boolean; neutral: string;
  status: ItemStatus; report?: Report; result?: Cleaned; error?: string; saved: boolean;
}
type Screen = 'start' | 'loading' | 'report' | 'after' | 'batch' | 'msg' | 'privacy';
type Msg = 'unsupported' | 'plain' | 'nothing' | 'big' | 'bigRun' | 'tooLarge' | 'error';

const storedMode = localStorage.getItem('um-mode') as ModeId | null;
const storedCustom = JSON.parse(localStorage.getItem('um-custom') ?? 'null') as Category[] | null;

export const app = $state({
  screen: 'start' as Screen, msg: 'error' as Msg,
  items: [] as Item[], current: 0,
  mode: (storedMode ?? 'maximum') as ModeId,
  custom: storedCustom ?? [...CATEGORIES],
  modeOpen: false, customOpen: false, details: false,
  view: 'after' as 'before' | 'after',
  toast: '', toastKey: 0,
  loadDone: 0, loadTotal: 0,
  batchPhase: 'found' as 'found' | 'cleaning' | 'done',
  cleaning: false, progress: 0,
  erasing: false,
});

export const removeSet = (): Category[] => (app.mode === 'custom' ? app.custom : MODE_REMOVE[app.mode]);
const keepSet = (): Category[] => CATEGORIES.filter((c) => !removeSet().includes(c));
export const item = (): Item | undefined => app.items[app.current];
export const mobile = () => matchMedia('(max-width: 640px), (pointer: coarse)').matches;
const RM = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- screens with View Transitions ----------
export async function go(fn: () => void, dir: 'fwd' | 'back' = 'fwd') {
  const doc = document as Document & { startViewTransition?: (cb: () => Promise<void>) => unknown };
  if (!doc.startViewTransition || RM()) { fn(); return; }
  document.documentElement.dataset.nav = dir;
  doc.startViewTransition(async () => { fn(); await tick(); });
}

export function toast(msg: string) { app.toast = msg; app.toastKey++; }

// ---------- limits: soft = warn first, hard = refuse (wasm32 + browser memory) ----------
export function limits() {
  const GB = 1024 ** 3;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // ponytail: guesses until measured on real phones (BRIEF «Большие файлы»)
  const soft = ios ? 1 * GB : nav.deviceMemory && mobile() ? Math.max(0.5, nav.deviceMemory / 4) * GB : 2 * GB;
  return { soft, hard: (ios ? 2 : 3.5) * GB };
}

// ---------- intake ----------
const PREVIEW = /^image\/(jpeg|png|webp|gif|avif|heic|heif|bmp)$/;
const NEUTRAL: Partial<Record<Kind, string>> = { image: 'photo', raw: 'photo', av: 'video', pdf: 'document', office: 'document', svg: 'image', text: 'text' };
let seq = 0;

async function makeItem(file: File, n: number): Promise<Item> {
  const kind = await kindOf(file);
  const video = file.type.startsWith('video/') || (kind === 'av' && /\.(mp4|mov|m4v|webm|mkv|avi|3gp)$/i.test(file.name));
  const base = kind === 'av' && !video ? 'audio' : NEUTRAL[kind] ?? 'file';
  return {
    id: ++seq, file, kind, video, saved: false, status: 'reading',
    url: PREVIEW.test(file.type) || video ? URL.createObjectURL(file) : '',
    neutral: `${base}_${String(n).padStart(2, '0')}`,
  };
}

export async function addFiles(files: File[]) {
  if (!files.length) return;
  for (const it of app.items) if (it.url) URL.revokeObjectURL(it.url);
  const items = await Promise.all(files.map((f, i) => makeItem(f, i + 1)));
  app.items = items; app.current = 0; app.view = 'after';
  if (items.length === 1) return single(items[0]);
  app.batchPhase = 'found';
  await go(() => { app.screen = 'batch'; });
  for (const it of app.items) await read(it);
}

async function single(it: Item) {
  const { soft, hard } = limits();
  if (it.file.size > hard) return go(() => { it.status = 'tooLarge'; app.msg = 'tooLarge'; app.screen = 'msg'; });
  if (it.kind === 'unsupported') return go(() => { it.status = 'unsupported'; app.msg = 'unsupported'; app.screen = 'msg'; });
  if (it.kind === 'text') return go(() => { it.status = 'plain'; app.msg = 'plain'; app.screen = 'msg'; });
  if (it.file.size > soft) return go(() => { it.status = 'big'; app.msg = 'big'; app.screen = 'msg'; });
  await openReport(it);
}

async function ensureAv() {
  if (avLoaded()) return;
  await go(() => { app.loadDone = 0; app.loadTotal = 0; app.screen = 'loading'; });
  await loadAv((d, tot) => { app.loadDone = d; app.loadTotal = tot; });
}

export async function openReport(it: Item) {
  try {
    if (it.kind === 'av') await ensureAv();
    await read(it);
    if (it.status === 'error') throw new Error(it.error);
    const nothing = it.report && !Object.keys(it.report.found).length;
    await go(() => {
      if (nothing) { app.msg = 'nothing'; app.screen = 'msg'; } else app.screen = 'report';
    });
  } catch (e) { fail(e); }
}

async function read(it: Item) {
  if (['unsupported', 'plain', 'tooLarge'].includes(it.status)) return;
  if (it.kind === 'unsupported') { it.status = 'unsupported'; return; }
  if (it.kind === 'text') { it.status = 'plain'; return; }
  if (it.file.size > limits().hard) { it.status = 'tooLarge'; return; }
  try {
    if (it.kind === 'av') await loadAv();
    it.report = await inspect(it.file, it.kind);
    it.status = Object.keys(it.report.found).length ? 'ready' : 'nothing';
  } catch (e) { it.status = 'error'; it.error = String(e instanceof Error ? e.message : e); }
}

// ---------- cleaning ----------
async function cleanItem(it: Item, onProgress?: (p: number) => void) {
  it.status = 'cleaning';
  try {
    it.result = await clean(it.file, keepSet(), it.neutral, onProgress);
    it.status = 'done'; it.saved = false;
  } catch (e) { it.status = 'error'; it.error = String(e instanceof Error ? e.message : e); }
}

export async function cleanCurrent() {
  const it = item(); if (!it || app.cleaning) return;
  app.cleaning = true; app.modeOpen = false;
  let real = 0, shown = 0;
  const t0 = performance.now();
  // Real progress only exists for ffmpeg; photos take ~0.1–2 s, so ease towards 90 % meanwhile.
  const frame = () => {
    if (!app.cleaning) return;
    const fake = 0.9 * (1 - Math.exp(-(performance.now() - t0) / 900));
    shown = Math.max(shown, real, fake);
    app.progress = shown;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  await cleanItem(it, (p) => { real = p * 0.95; });
  app.progress = 1;
  await new Promise((r) => setTimeout(r, RM() ? 0 : 220));
  app.cleaning = false;
  if (it.status === 'error') return fail(it.error);
  await go(() => { app.screen = app.screen === 'msg' ? 'after' : 'after'; app.view = 'after'; app.erasing = true; });
  setTimeout(() => { app.erasing = false; }, RM() ? 0 : 2400);
}

export async function cleanBatch() {
  app.batchPhase = 'cleaning';
  for (const it of app.items) if (it.status === 'ready') await cleanItem(it);
  app.batchPhase = 'done';
}

export async function tryBig() {
  const it = item(); if (!it) return;
  await go(() => { app.msg = 'bigRun'; app.progress = 0; });
  try {
    if (it.kind === 'av') await loadAv();
    await read(it);
    if (it.status === 'error') throw new Error(it.error);
    await cleanItem(it, (p) => { app.progress = p; });
    if (it.status === 'error') throw new Error(it.error);
    await go(() => { app.screen = 'after'; app.view = 'after'; app.erasing = true; });
    setTimeout(() => { app.erasing = false; }, 2400);
  } catch (e) { fail(e); }
}

export function fail(e: unknown) {
  const msg = String(e instanceof Error ? e.message : e ?? '');
  const it = item(); if (it) { it.status = 'error'; it.error = msg; }
  console.warn('[unmeta]', msg);
  go(() => { app.msg = 'error'; app.screen = 'msg'; });
}

export function errorText(raw = ''): string {
  if (/memory|out of bounds|allocation|RangeError/i.test(raw)) return t('errors.outOfMemory');
  if (/tool-load-failed|fetch|network/i.test(raw)) return t('errors.toolLoadFailed');
  if (/verify-failed|unsupported|pdf-encrypted/i.test(raw)) return t('errors.cleanFailed');
  return t('errors.generic');
}

// ---------- getting files out ----------
function download(blob: Blob, name: string) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Phones: the system share sheet ("Save image" puts it into the gallery). Elsewhere: a normal download. */
export async function save(it: Item) {
  const r = it.result; if (!r) return;
  const file = new File([r.blob], r.name, { type: it.file.type || r.blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  try {
    if (mobile() && nav.canShare?.({ files: [file] })) await navigator.share({ files: [file] });
    else download(file, r.name);
    it.saved = true;
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return; // user closed the sheet
    toast(t('errors.shareFailed'));
    download(file, r.name);
    it.saved = true;
  }
}

export async function saveAll() {
  const done = app.items.filter((i) => i.result);
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  const files = done.map((i) => new File([i.result!.blob], i.result!.name, { type: i.file.type }));
  if (mobile() && nav.canShare?.({ files })) {
    try { await navigator.share({ files }); done.forEach((i) => (i.saved = true)); return; }
    catch (e) { if ((e as DOMException)?.name === 'AbortError') return; }
  }
  try {
    const used = new Set<string>(), entries: Record<string, Uint8Array> = {};
    for (const f of files) {
      let n = f.name; for (let k = 2; used.has(n); k++) n = f.name.replace(/(\.\w+)?$/, `_${k}$1`);
      used.add(n); entries[n] = new Uint8Array(await f.arrayBuffer());
    }
    // level 0: photos/videos are already compressed; DOS epoch: no edit times inside the zip
    download(new Blob([zipSync(entries, { level: 0, mtime: new Date(1980, 0, 1) })], { type: 'application/zip' }), 'unmeta_clean.zip');
    done.forEach((i) => (i.saved = true));
  } catch { toast(t('errors.zipFailed')); }
}

// ---------- settings ----------
export function setMode(m: ModeId) {
  if (m === 'custom' && app.mode !== 'custom') app.custom = [...removeSet()];
  app.mode = m;
  localStorage.setItem('um-mode', m);
  if (m !== 'custom' && matchMedia('(max-width: 999px)').matches) app.modeOpen = false;
}
export function toggleCat(c: Category, on: boolean) {
  if (app.mode !== 'custom') { app.custom = [...removeSet()]; app.mode = 'custom'; localStorage.setItem('um-mode', 'custom'); toast(t('modes.custom.switched')); }
  app.customOpen = true;
  app.custom = on ? [...new Set([...app.custom, c])] : app.custom.filter((x) => x !== c);
  localStorage.setItem('um-custom', JSON.stringify(app.custom));
}

export function home() {
  go(() => { app.screen = 'start'; app.modeOpen = false; app.batchPhase = 'found'; }, 'back');
}

export function openItem(i: number) {
  app.current = i;
  const it = item(); if (!it) return;
  go(() => {
    if (it.status === 'done') { app.screen = 'after'; app.view = 'after'; }
    else if (it.status === 'ready') app.screen = 'report';
  });
}
