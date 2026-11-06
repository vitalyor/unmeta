// Files are cleaned here, away from the bot: a damaged file, a zip bomb or a hung parser takes down this process, never
// the bot. It stays warm between files (starting ExifTool takes 7 s on the server, a photo takes a fraction of one).
// Gets { path, name }, answers with what happened; a cleaned file stays on disk in its work folder.
import { dirname, join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { clean, kindOf, fileFromPath, makeThumb, warmUp, workDir, DiskFile, PRESETS, CATEGORIES } from './engine';
import { safeName } from './chat';

export type Done =
  | { outcome: 'cleaned'; out: string; name: string; thumb: string | null; removed: string[]; left: string[] }
  | { outcome: 'nothing' | 'text' | 'unsupported' | 'too-big' | 'empty' }
  | { outcome: 'error'; error: string };

const MAX_IN_MEMORY = 200 * 1024 ** 2; // photos and documents are parsed in memory on a 1 GB server

async function work({ path, name }: { path: string; name: string }): Promise<Done> {
  const file = await fileFromPath(path, name);
  if (!file.size) return { outcome: 'empty' };
  const kind = await kindOf(file);
  if (kind === 'unsupported') return { outcome: 'unsupported' };
  if (kind === 'text') return { outcome: 'text' };
  if (kind !== 'av' && file.size > MAX_IN_MEMORY) return { outcome: 'too-big' };
  const r = await clean(file, PRESETS.max);
  const found = CATEGORIES.filter((c) => r.before.found[c]);
  if (!found.length) return { outcome: 'nothing' };
  let out: string;
  if (r.blob instanceof DiskFile) out = r.blob.path;
  else { out = join(await workDir(), 'out'); await writeFile(out, new Uint8Array(await r.blob.arrayBuffer())); }
  const left = [...new Set(r.notes.filter((n) => n.startsWith('raw-kept:')).flatMap((n) => n.slice(9).split(',')))];
  const thumb = kind === 'av' || kind === 'image' ? await makeThumb(out, join(dirname(out), 'thumb.jpg')).catch(() => null) : null;
  return { outcome: 'cleaned', out, name: safeName(r.name), thumb, removed: found.filter((c) => !left.includes(c)), left };
}

process.on('disconnect', () => process.exit(1)); // the bot is gone: nobody needs the answer
warmUp();
process.on('message', async (m: { path: string; name: string }) => {
  let done: Done;
  try { done = await work(m); } catch (e) { done = { outcome: 'error', error: e instanceof Error ? e.message : String(e) }; }
  process.send!(done);
});
