// The site's engine, in-process: the same ExifTool (zeroperl wasm), classification and post-clean checks.
// Only audio/video differs: native ffmpeg (server/av.ts, swapped in by vite.server.config.ts).
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Perl } from '../src/engine/perl';
import { run } from '../src/engine/core';
import { setEngine } from '../src/engine/index';

const WASM = join(import.meta.dirname, 'zeroperl.wasm'); // copied next to the bundle by vite.server.config.ts
const RECYCLE_BYTES = 1024 ** 3; // wasm memory never shrinks: start a fresh Perl after 1 GB of input

let perl: Promise<Perl> | null = null;
let fed = 0;
let queue: Promise<unknown> = Promise.resolve();

setEngine((job) => {
  const next = queue.then(async () => {
    if (fed > RECYCLE_BYTES) { perl = null; fed = 0; }
    fed += job.file.size;
    perl ??= Perl.create(async () => new Response(await readFile(WASM), { headers: { 'content-type': 'application/wasm' } }));
    return { id: 0, ...(await run(await perl, job)) };
  });
  queue = next.catch(() => {});
  return next;
});

export * from '../src/engine/index';
export { fileFromPath, makeThumb, workDir, DiskFile, WORK } from './av';
