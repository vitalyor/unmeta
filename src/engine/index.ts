// Public engine API for the UI: inspect a file, clean it, verify the result.
import { detect, ext, type Kind } from './detect';
import { classify, CATEGORIES, type Category, type Tag } from './categories';

const UNREMOVABLE = new Set(['Photoshop:LayerModifyDates']); // PSD layer edit dates: read-only in ExifTool
const classifyName = (t: Tag) => classify(t) ?? 'other';
const BYTE_SCAN_MAX = 512 * 1024 ** 2;

/** Removed values (distinctive ones) that still occur anywhere in the output bytes. */
async function bytesLeft(blob: Blob, before: Report, after: Report, keep: Category[]): Promise<Tag[]> {
  const kept = after.tags.map((t) => t.value).join('\n');
  const cands = CATEGORIES.filter((c) => !keep.includes(c)).flatMap((c) => before.found[c] ?? [])
    .filter((t) => t.value.length >= 8 && !/^[\d\s:.,+\-/()]+$/.test(t.value) && t.value !== '(binary)' && !kept.includes(t.value) && !/ \((image|file)\d*\.\w+\)$/.test(t.value));
  if (!cands.length) return [];
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const enc = new TextEncoder();
  return cands.filter((t) => indexOfBytes(bytes, enc.encode(t.value)) >= 0);
}
import { cleanAv, probeAv, AV_KEEPABLE } from './av';
import { indexOfBytes } from './skeleton';
import type { Job, Res } from './core';

export { CATEGORIES, PRESETS, type Category, type PresetId, type Tag } from './categories';
export type { Kind } from './detect';
export { loadAv, avLoaded } from './av';

export interface Report {
  kind: Kind;
  tags: Tag[];
  /** Sensitive tags grouped by category; empty object = nothing found. */
  found: Partial<Record<Category, Tag[]>>;
}
export interface Cleaned { blob: Blob; name: string; before: Report; after: Report; notes: string[] }

// ponytail: one worker; parallel pool when batch timing on real phones says so
// The worker is recycled after RECYCLE_BYTES of input: Blobs it was handed stay alive until its GC runs, and GC
// ignores Blob sizes — after ~1.5 GB of big files in a row every new read failed ("Failed to fetch").
const RECYCLE_BYTES = 1024 ** 3;
let worker: Worker | null = null;
let seq = 0, fed = 0;
const pending = new Map<number, (r: Res) => void>();
let local: ((job: Job) => Promise<Res>) | null = null;
/** Run jobs in-process instead of in a Web Worker (the server: Node has no Worker for this). */
export function setEngine(fn: (job: Job) => Promise<Res>) { local = fn; }
function call(msg: Job): Promise<Res> {
  if (local) return local(msg);
  if (worker && fed > RECYCLE_BYTES && !pending.size) { worker.terminate(); worker = null; fed = 0; }
  fed += 'file' in msg ? msg.file.size : 0;
  worker ??= Object.assign(new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' }), {
    onmessage: ({ data }: MessageEvent<Res>) => { pending.get(data.id)?.(data); pending.delete(data.id); },
  });
  const id = ++seq;
  return new Promise((res) => { pending.set(id, res); worker!.postMessage({ ...msg, id }); });
}

/** Start downloading/compiling the Perl engine in the background (call after first paint). */
export function warmUp() { void call({ op: 'read', file: new File(['x'], 'warm.txt'), kind: 'text' }); }

export async function kindOf(file: File): Promise<Kind> {
  return detect(file.name, new Uint8Array(await file.slice(0, 192).arrayBuffer()));
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

/** The cleaned file keeps its name, plus a suffix: originals are never overwritten. */
export function cleanName(name: string): string {
  const i = ext(name) ? name.lastIndexOf('.') : name.length; // the extension stays exactly as it was (.MOV stays .MOV)
  return `${name.slice(0, i)}_clean${name.slice(i)}`;
}

/**
 * Clean `file`, keeping only categories in `keep`. Always re-reads the output: if anything removable survived, it throws instead of
 * pretending the file is clean.
 */
export async function clean(file: File, keep: Category[], onProgress?: (p: number) => void): Promise<Cleaned> {
  const before = await inspect(file);
  if (before.kind === 'unsupported') throw new Error('unsupported');
  const notes: string[] = [];
  const name = cleanName(file.name);
  const removed = (r: Report) => CATEGORIES.filter((c) => !keep.includes(c) && r.found[c]?.length);
  if (before.kind === 'raw') return cleanRaw(file, name, before, removed, notes);
  let blob: Blob;
  if (before.kind === 'av') {
    const dropped = keep.filter((c) => !AV_KEEPABLE.includes(c) && before.found[c]);
    if (dropped.length) notes.push(`av-cannot-keep:${dropped.join(',')}`);
    blob = await cleanAv(file, before.tags, keep, onProgress, async (bytes, n) => {
      const r = await call({ op: 'clean', file: new File([bytes as Uint8Array<ArrayBuffer>], n), kind: 'image', keep });
      if (r.error) throw new Error(r.error);
      return r.bytes!;
    });
  } else {
    const r = await call({ op: 'clean', file, kind: before.kind, keep });
    if (r.error) throw new Error(r.error);
    blob = new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: file.type });
  }
  // a File stays as is: on the server it is the cleaned file on disk, and wrapping it would lose its path
  const after = await inspect(blob instanceof File ? blob : new File([blob], name, { type: file.type }), before.kind);
  // Byte-level check for pictures: every removed value must be gone from the whole file, not only from what
  // ExifTool parses (PSD smart objects embed whole documents with their own XMP; ExifTool doesn't see them).
  if (before.kind === 'image' && blob.size <= BYTE_SCAN_MAX) {
    const left = await bytesLeft(blob, before, after, keep);
    if (left.length) {
      if (/^8BPS/.test(String.fromCharCode(...new Uint8Array(await blob.slice(0, 4).arrayBuffer())))) notes.push(`raw-kept:${[...new Set(left.map((t) => classifyName(t)))].join(',')}`);
      else throw new Error(`verify-failed:bytes [${left.map((t) => `${t.group1}:${t.name}`).join(' | ')}]`);
    }
  }
  // Fields no tool can rewrite in place (read-only even for ExifTool): reported as left, not a failure.
  const stuck = after.tags.filter((t) => UNREMOVABLE.has(`${t.group1}:${t.name}`));
  for (const c of CATEGORIES) if (after.found[c]) after.found[c] = after.found[c]!.filter((t) => !stuck.includes(t));
  for (const c of CATEGORIES) if (after.found[c] && !after.found[c]!.length) delete after.found[c];
  if (stuck.length) notes.push(`raw-kept:${[...new Set(stuck.map((t) => classifyName(t)))].join(',')}`);
  const leaked = removed(after);
  if (leaked.length) {
    const detail = leaked.flatMap((c) => after.found[c]!.map((t) => `${t.group1}:${t.name}=${t.value}`)).join(' | ');
    throw new Error(`verify-failed:${leaked.join(',')} [${detail}]`);
  }
  return { blob, name, before, after, notes };
}
