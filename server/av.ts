// Audio/video on the server: the same remux as the browser (src/engine/av-args.ts), run by native ffmpeg.
// Files stay on disk: a 2 GB video is never loaded into this 1 GB machine's memory.
import { spawn } from 'node:child_process';
import { openAsBlob } from 'node:fs';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { join } from 'node:path';
import { ext } from '../src/engine/detect';
import { parseTags, avStreams, remuxArgs } from '../src/engine/av-args';
import type { Category, Tag } from '../src/engine/categories';

export { AV_KEEPABLE } from '../src/engine/av-args';
export const WORK = process.env.WORK_DIR ?? '/tmp/unmeta';

/** A File that knows where it lives on disk (lazy: the bytes are read only when asked for). */
export class DiskFile extends File {
  constructor(blob: Blob, name: string, readonly path: string) { super([blob], name, { type: blob.type }); }
}
export const fileFromPath = async (path: string, name: string) => new DiskFile(await openAsBlob(path), name, path);
// mkdtemp makes the folder private to this user, but the Bot API server runs as another one and must read the file it sends
export const workDir = async () => { await mkdir(WORK, { recursive: true }); const d = await mkdtemp(join(WORK, 'job-')); await chmod(d, 0o755); return d; };

// The browser API, for engine/index.ts: native ffmpeg needs no download.
export const loadAv = async () => {};
export const avLoaded = () => true;

function ffmpeg(args: string[], onLine?: (line: string) => void): Promise<{ code: number; log: string }> {
  return new Promise((res, rej) => {
    const p = spawn('ffmpeg', ['-nostdin', '-y', '-hide_banner', ...args], { stdio: ['ignore', 'ignore', 'pipe'] });
    let log = '';
    p.stderr.setEncoding('utf8').on('data', (s: string) => { log += s; if (onLine) for (const l of s.split(/[\r\n]/)) onLine(l); });
    p.on('error', rej);
    p.on('close', (code) => res({ code: code ?? 1, log }));
  });
}
const info = async (path: string) => (await ffmpeg(['-i', path])).log; // exits 1: no output, by design

/** Run fn on a path to the file: its own if it has one, else a temporary copy. */
async function withPath<T>(file: File, fn: (path: string) => Promise<T>): Promise<T> {
  if (file instanceof DiskFile) return fn(file.path);
  const dir = await workDir();
  try {
    const path = join(dir, 'in.' + (ext(file.name) || 'bin'));
    await pipeline(Readable.fromWeb(file.stream() as never), createWriteStream(path));
    return await fn(path);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

export const probeAv = (file: File): Promise<Tag[]> => withPath(file, async (path) => parseTags(await info(path)));

/** Cleaned file, on disk in its own work dir (the caller sends it and removes the dir). */
export function cleanAv(file: File, tags: Tag[], keep: Category[], onProgress?: (p: number) => void,
  cleanCover?: (bytes: Uint8Array, name: string) => Promise<Uint8Array>): Promise<Blob> {
  return withPath(file, async (path) => {
    const e = ext(file.name) || 'mp4';
    const dir = await workDir();
    try {
      const log = await info(path);
      const streams = avStreams(log);
      if (!streams.some((s) => !s.cover)) throw new Error('no-av-streams'); // nothing playable: refuse, never hand out an empty file
      // Cover art is a photo with its own EXIF/GPS: take it out, clean it like any photo, put it back (no re-encode).
      const covers: string[] = [];
      for (const [k, c] of streams.filter((s) => s.cover).entries()) {
        if (!cleanCover) break;
        const raw = join(dir, `cover${k}.${/png/.test(c.codec) ? 'png' : 'jpg'}`);
        if ((await ffmpeg(['-i', path, '-map', `0:${c.i}`, '-c', 'copy', '-f', 'image2', raw])).code !== 0) throw new Error('cover-extract-failed');
        await writeFile(raw, await cleanCover(new Uint8Array(await readFile(raw)), raw.slice(dir.length + 1)));
        covers.push(raw);
      }
      const out = join(dir, `out.${e}`);
      const total = Number(log.match(/Duration: (\d+):(\d+):([\d.]+)/)?.slice(1).reduce((s, v) => s * 60 + Number(v), 0)) || 0;
      const { code } = await ffmpeg(remuxArgs({ input: path, log, ext: e, covers: cleanCover ? covers : null, tags, keep, out }), (l) => {
        const t = l.match(/time=(\d+):(\d+):([\d.]+)/);
        if (t && total) onProgress?.(Math.min(1, t.slice(1).reduce((s, v) => s * 60 + Number(v), 0) / total));
      });
      if (code !== 0) throw new Error(`ffmpeg exit ${code}`);
      if (!avStreams(await info(out)).length) throw new Error('no-av-streams');
      for (const c of covers) await rm(c, { force: true });
      return await fileFromPath(out, `out.${e}`);
    } catch (err) {
      await rm(dir, { recursive: true, force: true });
      throw err;
    }
  });
}
