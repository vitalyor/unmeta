// Video and audio via ffmpeg.wasm: remux without re-encoding. 271 MB MP4 → ~0.35 s in the spike.
// Loaded lazily on the first audio/video file (~9.7 MB gzip).
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { ext } from './detect';

import type { Category, Tag } from './categories';

let ffmpeg: Promise<FFmpeg> | null = null;
let loaded = false;
export const avLoaded = () => loaded;
// Uncompressed size of @ffmpeg/core 0.12.10's wasm: with gzip/brotli the stream length isn't known up front.
const WASM_BYTES = 32_232_419;

/** Download (with progress) and start ffmpeg once; later calls reuse it. */
export function loadAv(onProgress?: (done: number, total: number) => void): Promise<FFmpeg> {
  return (ffmpeg ??= (async () => {
    const res = await fetch(wasmURL);
    if (!res.ok || !res.body) throw new Error('tool-load-failed');
    const total = res.headers.get('content-encoding') ? WASM_BYTES : Number(res.headers.get('content-length')) || WASM_BYTES;
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let done = 0;
    for (const reader = res.body.getReader(); ;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      chunks.push(value); done += value.length; onProgress?.(Math.min(done, total), total);
    }
    const blobURL = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' }));
    const f = new FFmpeg();
    await f.load({ coreURL, wasmURL: blobURL });
    loaded = true;
    return f;
  })().catch((e) => { ffmpeg = null; throw e; }));
}
const load = () => loadAv();

// Re-add values of kept categories (ffmpeg writes them as standard container tags).
function keptTags(tags: Tag[], keep: Category[]): string[] {
  const out: string[] = [];
  const first = (re: RegExp, valid: (v: string) => boolean = () => true) => tags.find((t) => re.test(t.name) && valid(t.value))?.value;
  const realDate = (v: string) => /^\d{4}:\d\d:\d\d/.test(v) && !v.startsWith('0000');
  if (keep.includes('dates')) {
    const d = first(/^(CreationDate|CreateDate|DateTimeOriginal|ContentCreateDate|Date)$/, realDate);
    if (d) out.push('-metadata', `creation_time=${d.replace(/^(\d{4}):(\d\d):(\d\d) /, '$1-$2-$3T').replace(/([+-]\d\d:\d\d|Z)?$/, (z) => z || 'Z')}`);
  }
  if (keep.includes('author')) {
    const a = first(/^(Artist|Author|Creator)$/); if (a) out.push('-metadata', `artist=${a}`);
    const c = first(/^Copyright$/); if (c) out.push('-metadata', `copyright=${c}`);
  }
  if (keep.includes('descriptions')) {
    const t = first(/^Title$/); if (t) out.push('-metadata', `title=${t}`);
    const c = first(/^(Comment|Description)$/); if (c) out.push('-metadata', `comment=${c}`);
  }
  return out;
}

async function withInput<T>(f: FFmpeg, file: File, fn: (path: string) => Promise<T>): Promise<T> {
  // WORKERFS reads the File lazily — no copy of the input in wasm memory.
  const dir = `/in${Math.random().toString(36).slice(2)}`;
  await f.createDir(dir);
  await f.mount(FFFSType.WORKERFS, { files: [file] }, dir);
  try { return await fn(`${dir}/${file.name}`); }
  finally {
    await f.unmount(dir).catch(() => {});
    await f.deleteDir(dir).catch(() => {});
  }
}

/**
 * Container tags as ffmpeg sees them (global + per stream). ExifTool misses some of these
 * (e.g. Matroska ARTIST, some M4A atoms), so the report and the post-clean check use both.
 */
export async function probeAv(file: File): Promise<Tag[]> {
  const f = await load();
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  f.on('log', onLog);
  try { await withInput(f, file, (path) => f.exec(['-hide_banner', '-i', path])); } // exits 1: no output, by design
  finally { f.off('log', onLog); }
  const tags: Tag[] = [];
  let inMeta = false, indent = 0;
  for (const raw of lines.join('\n').split('\n')) {
    const lead = raw.length - raw.trimStart().length;
    if (/^\s*Metadata:\s*$/.test(raw)) { inMeta = true; indent = lead; continue; }
    if (!inMeta) continue;
    const m = raw.match(/^\s*([^:]+?)\s*:\s?(.*)$/);
    if (lead <= indent || !m) { inMeta = false; continue; }
    tags.push({ group0: 'ffmpeg', group1: 'ffmpeg', group2: '', name: m[1], value: m[2].slice(0, 200) });
  }
  return tags;
}

/** Categories that can be kept for audio/video in v1. Others are removed even if the user kept them. */
export const AV_KEEPABLE: Category[] = ['dates', 'author', 'descriptions', 'filename'];

export async function cleanAv(file: File, tags: Tag[], keep: Category[], onProgress?: (p: number) => void): Promise<Blob> {
  const f = await load();
  const e = ext(file.name) || 'mp4';
  const out = `/out.${e}`;
  const prog = ({ progress }: { progress: number }) => onProgress?.(Math.min(1, Math.max(0, progress)));
  f.on('progress', prog);
  try {
    const subs = /^(mkv|webm)$/.test(e) ? ['-map', '0:s?'] : []; // mp4/mov subtitle tracks are often drone/action-cam telemetry (GPS)
    const code = await withInput(f, file, (path) => f.exec([
      '-i', path,
      // video + audio only: data tracks (GoPro GPMF, DJI, iPhone mebx) can hold per-frame GPS
      '-map', '0:v?', '-map', '0:a?', ...subs,
      '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy',
      '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
      ...keptTags(tags, keep), out,
    ]));
    if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
    const data = (await f.readFile(out)) as Uint8Array<ArrayBuffer>;
    await f.deleteFile(out);
    return new Blob([data], { type: file.type });
  } finally {
    f.off('progress', prog);
  }
}
