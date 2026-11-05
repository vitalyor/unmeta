// Public engine API for the UI: inspect a file, clean it, verify the result.
import { detect, ext, type Kind } from './detect';
import { classify, CATEGORIES, type Category, type Tag } from './categories';
import { cleanAv, probeAv, AV_KEEPABLE } from './av';
import type { Req, Res } from './engine.worker';

export { CATEGORIES, PRESETS, type Category, type PresetId, type Tag } from './categories';
export type { Kind } from './detect';

export interface Report {
  kind: Kind;
  tags: Tag[];
  /** Sensitive tags grouped by category; empty object = nothing found. */
  found: Partial<Record<Category, Tag[]>>;
}
export interface Cleaned { blob: Blob; name: string; before: Report; after: Report; notes: string[] }

// ponytail: one worker; parallel pool when batch timing on real phones says so
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (r: Res) => void>();
function call(msg: Omit<Req, 'id'>): Promise<Res> {
  worker ??= Object.assign(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }), {
    onmessage: ({ data }: MessageEvent<Res>) => { pending.get(data.id)?.(data); pending.delete(data.id); },
  });
  const id = ++seq;
  return new Promise((res) => { pending.set(id, res); worker!.postMessage({ ...msg, id }); });
}

/** Start downloading/compiling the Perl engine in the background (call after first paint). */
export function warmUp() { void call({ op: 'read', file: new File(['x'], 'warm.txt'), kind: 'text' }); }

export async function kindOf(file: File): Promise<Kind> {
  return detect(file.name, new Uint8Array(await file.slice(0, 64).arrayBuffer()));
}

export async function inspect(file: File, kind?: Kind): Promise<Report> {
  kind ??= await kindOf(file);
  if (kind === 'text' || kind === 'unsupported') return { kind, tags: [], found: {} };
  const [r, avTags] = await Promise.all([call({ op: 'read', file, kind }), kind === 'av' ? probeAv(file) : []]);
  if (r.error) throw new Error(r.error);
  const tags = [...(r.tags ?? []), ...avTags];
  const found: Report['found'] = {};
  for (const t of tags) {
    const c = classify(t);
    if (c) (found[c] ??= []).push(t);
  }
  return { kind, tags, found };
}

// RAW can't be wiped wholesale: remove exactly the private tags found, in up to two passes. Make/Model,
// MakerNotes structure and previews stay (decoders need them); what can't be touched is reported, not hidden.
const isSerial = (t: Tag) => /Serial|OwnerName|HostComputer/i.test(t.name) && !/^[0\s]*$/.test(t.value);
async function cleanRaw(file: File, name: string, before: Report, removed: (r: Report) => Category[], notes: string[]): Promise<Cleaned> {
  let blob: Blob = file;
  let report = before;
  for (let pass = 0; pass < 2; pass++) {
    const targets = [...removed(report).filter((c) => c !== 'device' && c !== 'thumbnails').flatMap((c) => report.found[c]!), ...report.tags.filter(isSerial)];
    if (!targets.length) break;
    const r = await call({ op: 'scrub', file: new File([blob], name), tags: targets });
    if (r.error) throw new Error(r.error);
    blob = new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: file.type });
    report = await inspect(new File([blob], name, { type: file.type }), 'raw');
  }
  const kept: string[] = removed(report);
  if (report.tags.some(isSerial)) kept.push('serial'); // e.g. Nikon: serial is the key to encrypted white balance
  if (kept.length) notes.push(`raw-kept:${kept.join(',')}`);
  return { blob, name, before, after: report, notes };
}

export function cleanName(name: string, keep: Category[], neutral: string): string {
  const e = ext(name);
  const base = keep.includes('filename') ? (e ? name.slice(0, -(e.length + 1)) : name) : neutral;
  return `${base}_clean${e ? '.' + e : ''}`;
}

/**
 * Clean `file`, keeping only categories in `keep`. `neutral` = name used when the filename is not kept
 * (e.g. "photo_01"). Always re-reads the output: if anything removable survived, it throws instead of
 * pretending the file is clean.
 */
export async function clean(file: File, keep: Category[], neutral: string, onProgress?: (p: number) => void): Promise<Cleaned> {
  const before = await inspect(file);
  if (before.kind === 'unsupported') throw new Error('unsupported');
  const notes: string[] = [];
  const name = cleanName(file.name, keep, neutral);
  const removed = (r: Report) => CATEGORIES.filter((c) => c !== 'filename' && !keep.includes(c) && r.found[c]?.length);
  if (before.kind === 'raw') return cleanRaw(file, name, before, removed, notes);
  let blob: Blob;
  if (before.kind === 'av') {
    const dropped = keep.filter((c) => !AV_KEEPABLE.includes(c) && before.found[c]);
    if (dropped.length) notes.push(`av-cannot-keep:${dropped.join(',')}`);
    blob = await cleanAv(file, before.tags, keep, onProgress);
  } else {
    const r = await call({ op: 'clean', file, kind: before.kind, keep });
    if (r.error) throw new Error(r.error);
    blob = new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: file.type });
  }
  const after = await inspect(new File([blob], name, { type: file.type }), before.kind);
  const leaked = removed(after);
  if (leaked.length) {
    const detail = leaked.flatMap((c) => after.found[c]!.map((t) => `${t.group1}:${t.name}=${t.value}`)).join(' | ');
    throw new Error(`verify-failed:${leaked.join(',')} [${detail}]`);
  }
  return { blob, name, before, after, notes };
}
