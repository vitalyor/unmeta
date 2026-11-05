// Video and audio via ffmpeg.wasm: remux without re-encoding. 271 MB MP4 → ~0.35 s in the spike.
// Loaded lazily on the first audio/video file (~9.7 MB gzip).
import { FFmpeg, FFFSType } from '@ffmpeg/ffmpeg';
import coreURL from '@ffmpeg/core?url';
import wasmURL from '@ffmpeg/core/wasm?url';
import { ext } from './detect';
import { parseTags, avStreams, remuxArgs } from './av-args';

import type { Category, Tag } from './categories';

let ffmpeg: Promise<FFmpeg> | null = null;
let loaded = false;
export const avLoaded = () => loaded;
// Uncompressed size of @ffmpeg/core 0.12.10's wasm: with gzip/brotli the stream length isn't known up front.
const WASM_BYTES = 32_232_419;

let wasmBlobURL: string | null = null; // downloaded once per page; a recycled instance reuses it

/** Download (with progress) and start ffmpeg once; later calls reuse it. */
export function loadAv(onProgress?: (done: number, total: number) => void): Promise<FFmpeg> {
  return (ffmpeg ??= (async () => {
    if (wasmBlobURL) {
      const f = new FFmpeg();
      await f.load({ coreURL, wasmURL: wasmBlobURL });
      loaded = true;
      return f;
    }
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
    const blobURL = (wasmBlobURL = URL.createObjectURL(new Blob(chunks, { type: 'application/wasm' })));
    const f = new FFmpeg();
    await f.load({ coreURL, wasmURL: blobURL });
    loaded = true;
    return f;
  })().catch((e) => { ffmpeg = null; throw e; }));
}
const load = () => loadAv();

// One ffmpeg instance, one job at a time; a crashed instance (e.g. "memory access out of bounds" on a
// malformed file) is thrown away so it can't poison every following file.
// ffmpeg.wasm's heap degrades over many files (Safari crashed with "out of bounds" after ~100 files in a row):
// recycle the instance every RECYCLE_JOBS jobs / RECYCLE_BYTES of input, and retry a crashed file once on a fresh one.
const RECYCLE_JOBS = 20, RECYCLE_BYTES = 1024 ** 3;
let jobs = 0, bytes = 0;
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(size: number, fn: () => Promise<T>): Promise<T> {
  const attempt = async () => {
    if (jobs >= RECYCLE_JOBS || bytes >= RECYCLE_BYTES) await reset();
    jobs++; bytes += size;
    try { return await fn(); }
    catch (e) {
      if (!/out of bounds|RuntimeError|memory|unreachable/i.test(String(e))) throw e;
      await reset(); jobs = 1; bytes = size;
      return fn(); // once, on a fresh instance
    }
  };
  const run = chain.then(attempt, attempt);
  chain = run.catch(() => {});
  return run;
}
async function reset() {
  const f = await ffmpeg?.catch(() => null);
  try { f?.terminate(); } catch { /* already gone */ }
  ffmpeg = null; loaded = false; jobs = 0; bytes = 0;
}

// WORKERFS reads the File lazily (no copy in wasm memory) but pays per read: a 43 MB, 15-minute MP4 with 67k
// small packets took 7.7 s (36 s in iOS Safari) vs 0.3 s natively. Smaller files are copied in once instead.
const LAZY_FROM = 256 * 1024 ** 2;

async function withInput<T>(f: FFmpeg, file: File, fn: (path: string) => Promise<T>): Promise<T> {
  if (file.size < LAZY_FROM) {
    const path = `/in${Math.random().toString(36).slice(2)}_${file.name.replace(/[^\w.-]/g, '_').slice(-60)}`;
    await f.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    try { return await fn(path); }
    finally { await f.deleteFile(path).catch(() => {}); }
  }
  const dir = `/in${Math.random().toString(36).slice(2)}`;
  await f.createDir(dir);
  await f.mount(FFFSType.WORKERFS, { files: [file] }, dir);
  try { return await fn(`${dir}/${file.name}`); }
  finally {
    await f.unmount(dir).catch(() => {});
    await f.deleteDir(dir).catch(() => {});
  }
}

/** ffmpeg's log for `-i path` (stream list + metadata). */
async function info(f: FFmpeg, path: string): Promise<string> {
  const lines: string[] = [];
  const onLog = ({ message }: { message: string }) => lines.push(message);
  f.on('log', onLog);
  try { await f.exec(['-hide_banner', '-i', path]); } // exits 1: no output, by design
  finally { f.off('log', onLog); }
  return lines.join('\n');
}

/**
 * Container tags as ffmpeg sees them (global + per stream). ExifTool misses some of these
 * (e.g. Matroska ARTIST, some M4A atoms), so the report and the post-clean check use both.
 */
export function probeAv(file: File): Promise<Tag[]> {
  return serial(file.size, async () => {
    const f = await load();
    let log: string;
    try { log = await withInput(f, file, (path) => info(f, path)); }
    catch (e) { await reset(); throw e; }
    return parseTags(log);
  });
}
export { AV_KEEPABLE } from './av-args';

export function cleanAv(file: File, tags: Tag[], keep: Category[], onProgress?: (p: number) => void,
  cleanCover?: (bytes: Uint8Array, name: string) => Promise<Uint8Array>): Promise<Blob> {
  return serial(file.size, async () => {
    const f = await load();
    const e = ext(file.name) || 'mp4';
    const out = `/out.${e}`;
    const prog = ({ progress }: { progress: number }) => onProgress?.(Math.min(1, Math.max(0, progress)));
    f.on('progress', prog);
    try {
      return await withInput(f, file, async (path) => {
        const log = await info(f, path);
        const streams = avStreams(log);
        if (!streams.some((s) => !s.cover)) throw new Error('no-av-streams'); // nothing playable: refuse, never hand out an empty file
        // Cover art is a photo and keeps its own EXIF/GPS: take it out, clean it like any photo, put it back (no re-encode).
        const covers = streams.filter((s) => s.cover);
        const coverArgs: string[] = [];
        for (const [k, c] of covers.entries()) {
          if (!cleanCover) continue;
          const kind = /png/.test(c.codec) ? 'png' : 'jpg';
          const raw = `/cover${k}.${kind}`;
          if (await f.exec(['-i', path, '-map', `0:${c.i}`, '-c', 'copy', '-f', 'image2', raw]) !== 0) throw new Error('cover-extract-failed');
          const clean = await cleanCover(await f.readFile(raw) as Uint8Array, `cover.${kind}`);
          await f.writeFile(raw, clean);
          coverArgs.push(raw);
        }
        const code = await f.exec(remuxArgs({ input: path, log, ext: e, covers: cleanCover ? coverArgs : null, tags, keep, out }));
        if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
        if (!avStreams(await info(f, out)).length) throw new Error('no-av-streams');
        const data = (await f.readFile(out)) as Uint8Array<ArrayBuffer>;
        await f.deleteFile(out);
        for (const c of coverArgs) await f.deleteFile(c).catch(() => {});
        return new Blob([data], { type: file.type });
      });
    } catch (err) {
      await reset();
      throw err;
    } finally {
      f.off('progress', prog);
    }
  });
}
