// ffmpeg logic shared by ffmpeg.wasm (browser, av.ts) and native ffmpeg (server/av.ts):
// how to read its log and which remux command cleans a file.
import type { Category, Tag } from './categories';

/** Categories that can be kept for audio/video in v1. Others are removed even if the user kept them. */
export const AV_KEEPABLE: Category[] = ['dates', 'author', 'descriptions'];

/**
 * Container tags as ffmpeg sees them (global + per stream). ExifTool misses some of these
 * (e.g. Matroska ARTIST, some M4A atoms), so the report and the post-clean check use both.
 */
export function parseTags(log: string): Tag[] {
  const tags: Tag[] = [];
  let inMeta = false, indent = 0;
  for (const raw of log.split('\n')) {
    const lead = raw.length - raw.trimStart().length;
    if (/^\s*Metadata:\s*$/.test(raw)) { inMeta = true; indent = lead; continue; }
    if (!inMeta) continue;
    const m = raw.match(/^\s*([^:]+?)\s*:\s?(.*)$/);
    if (lead <= indent || !m) { inMeta = false; continue; }
    tags.push({ group0: 'ffmpeg', group1: 'ffmpeg', group2: '', name: m[1], value: m[2].slice(0, 200) });
  }
  return tags;
}

// Output container follows what the file really is, not its name: an MP4 renamed to .mp3 stays an MP4.
export function muxer(log: string, e: string): string {
  const demux = log.match(/Input #0, ([^,\s]+(?:,[^,\s]+)*), from/)?.[1] ?? '';
  if (/^mov,mp4/.test(demux)) return /^(m4a|m4b|m4p)$/.test(e) ? 'ipod' : /^(3gp|3g2)$/.test(e) ? '3gp' : /^(mov|qt)$/.test(e) ? 'mov' : 'mp4';
  if (/^matroska/.test(demux)) return e === 'webm' ? 'webm' : 'matroska';
  const map: Record<string, string> = { mp3: 'mp3', flac: 'flac', ogg: 'ogg', wav: 'wav', avi: 'avi', asf: 'asf', mpegts: 'mpegts', aiff: 'aiff', aac: 'adts', mpeg: 'mpeg' };
  return map[demux.split(',')[0]] ?? demux.split(',')[0];
}

export interface Stream { i: number; type: string; cover: boolean; codec: string }
export const avStreams = (log: string): Stream[] => [...log.matchAll(/Stream #0:(\d+)[^:]*: (Video|Audio): ([^\n]*)/g)].map((m) => ({ i: Number(m[1]), type: m[2], cover: /\(attached pic\)/.test(m[3]), codec: m[3].split(/[ ,]/)[0] }));

// Re-add values of kept categories (ffmpeg writes them as standard container tags).
function keptTags(tags: Tag[], keep: Category[]): string[] {
  const out: string[] = [];
  const first = (re: RegExp, valid: (v: string) => boolean = () => true) => tags.find((t) => re.test(t.name) && valid(t.value))?.value;
  const realDate = (v: string) => /^\d{4}:\d\d:\d\d/.test(v) && !v.startsWith('0000');
  if (keep.includes('dates')) {
    const d = first(/^(CreationDate|CreateDate|DateTimeOriginal|ContentCreateDate|Date)$/, realDate);
    const tc = first(/^timecode$/);
    if (tc) out.push('-timecode', tc);
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

/**
 * The cleaning remux: video + audio only (no data tracks: GoPro GPMF, DJI, iPhone mebx GPS), no metadata or
 * chapters, no re-encoding. `covers` = already cleaned cover images that replace the original cover streams.
 */
export function remuxArgs(o: { input: string; log: string; ext: string; covers: string[] | null; tags: Tag[]; keep: Category[]; out: string }): string[] {
  const streams = avStreams(o.log);
  const swap = o.covers !== null; // covers are taken out, cleaned and put back
  const covers = o.covers ?? [];
  const subs = /^(mkv|webm)$/.test(o.ext) ? ['-map', '0:s?'] : []; // mp4/mov subtitle tracks are often drone/action-cam telemetry (GPS)
  const maps = streams.filter((s) => !s.cover || !swap).flatMap((s) => ['-map', `0:${s.i}`]);
  const nMain = streams.filter((s) => s.type === 'Video' && (!s.cover || !swap)).length;
  return [
    '-i', o.input, ...covers.flatMap((c) => ['-i', c]),
    ...maps, ...subs, ...covers.flatMap((_, k) => ['-map', `${k + 1}:0`]),
    '-map_metadata', '-1', '-map_chapters', '-1', '-c', 'copy',
    ...covers.flatMap((_, k) => [`-disposition:v:${nMain + k}`, 'attached_pic']),
    ...(o.ext === 'mp3' ? ['-id3v2_version', '3'] : []),
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
    ...keptTags(o.tags, o.keep), '-f', muxer(o.log, o.ext), o.out,
  ];
}
