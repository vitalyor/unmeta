// Browser engine worker: one zeroperl instance, jobs from the page run through core.ts one at a time.
// Audio/video cleaning runs through ffmpeg.wasm on the main thread (it has its own worker).
import './worker-shim';
import wasmURL from '@6over3/zeroperl-ts/zeroperl.wasm?url';
import { Perl } from './perl';
import { run, type Req, type Res } from './core';

export type { Req, Res } from './core';

const perl = Perl.create(() => fetch(wasmURL));
perl.catch(() => {}); // surfaced on first request

// One Perl interpreter = one job at a time: overlapping evals share its output buffer, and a read that ran
// alongside the warm-up came back empty — the report said "nothing found" for a photo with GPS. Queue them.
let queue: Promise<unknown> = Promise.resolve();
self.onmessage = ({ data: req }: MessageEvent<Req>) => { queue = queue.then(() => handle(req)); };

async function handle(req: Req) {
  let r: Omit<Res, 'id'>;
  try { r = await run(await perl, req); }
  catch (e) { r = { error: e instanceof Error ? e.message : String(e) }; }
  postMessage({ id: req.id, ...r } satisfies Res, r.bytes ? { transfer: [r.bytes.buffer as ArrayBuffer] } : {});
}
