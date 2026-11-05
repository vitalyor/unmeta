// What the bot decides from a Telegram message alone, before touching any file.
import { ext, RAW, OFFICE } from '../src/engine/detect.ts';

export type Media = { file_id: string; file_size?: number; file_name?: string; mime_type?: string };
export type Item = { media: Media; name: string; photo: boolean };
type Tag = { group1?: string; name?: string; value: string };

const MAX_BYTES = 2000 * 1024 ** 2; // local Bot API limit
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' };
// By name and type only: nothing is downloaded until someone presses a button. Text formats stay out: nowhere to hide data.
const MEDIA = /^(jpe?g|png|gif|webp|hei[cf]|avif|tiff?|psd|psb|pdf|svg|mp4|m4v|mov|qt|mkv|webm|avi|wmv|asf|3gp|3g2|mts|m2ts|mpg|mpeg|vob|mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|aiff?|wma)$/;

export function mediaOf(m: any): Item | null {
  if (m.photo) return { media: m.photo.at(-1), name: 'photo.jpg', photo: true };
  const media: Media | undefined = m.document ?? m.video ?? m.audio ?? m.animation ?? m.voice ?? m.video_note;
  if (!media) return null;
  const e = EXT[media.mime_type ?? ''] ?? media.mime_type?.split('/')[1] ?? 'bin';
  return { media, name: media.file_name ?? `${m.voice ? 'voice' : m.audio ? 'audio' : 'video'}.${e}`, photo: false };
}

/** Should the bot offer its buttons under this group message? Files only: not compressed photos, GIFs or voice notes. */
export function offerable(m: any): boolean {
  const media: Media | undefined = m.document ?? m.video ?? m.audio;
  if (!media || m.from?.is_bot || (media.file_size ?? 0) > MAX_BYTES) return false;
  const name = media.file_name ?? '';
  if (/_clean\.\w+$/i.test(name)) return false; // already ours
  const e = ext(name);
  return e ? MEDIA.test(e) || RAW.test(e) || OFFICE.test(e) : /^(video|audio|image)\/|^application\/pdf$/.test(media.mime_type ?? '');
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The Bot API URL-decodes local paths: "100%.mp4" would point nowhere unencoded. */
export const fileUri = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`;

const paths = (t: Tag) => (/Path$/.test(t.name ?? '') ? 0 : 1); // folders and source file names say the most: first

/** Report for the chat, with values: everyone in the group sees it, so coordinates stay "found", never numbers. */
export function metaText(title: string, cats: string[], found: Record<string, Tag[] | undefined>, label: (c: string) => string, yes: string, more: (n: number) => string): string {
  const lines = [title];
  for (const c of cats) {
    const tags = [...(found[c] ?? [])].sort((a, b) => paths(a) - paths(b) || a.value.localeCompare(b.value));
    const vals = [...new Set(tags.map((t) => t.value.replace(/\s*\((image|file)\d*\.\w+\)$/, '')).filter((v) => v && v !== '(binary)'))];
    const hidden = c === 'location' || c === 'thumbnails' || c === 'c2pa' || !vals.length;
    lines.push(`\n<b>${esc(label(c))}</b>`, ...(hidden ? [yes] : vals.slice(0, 10).map((v) => esc([...v].slice(0, 120).join('')))));
    if (!hidden && vals.length > 10) lines.push(more(vals.length - 10));
  }
  let cut = 0;
  while (lines.join('\n').length > 3800) { lines.pop(); cut++; } // Telegram's limit is 4096
  if (cut) lines.push(more(cut));
  return lines.join('\n');
}

/** Every field, for the file behind "All fields": location stays "found" here too, the file lands in the chat. */
export function allFields(tags: Tag[], found: Record<string, Tag[] | undefined>, yes: string): string {
  const place = new Set(found.location ?? []);
  return tags.map((t) => `${t.group1}:${t.name} = ${place.has(t) ? yes : t.value}`).sort((a, b) => a.localeCompare(b)).join('\n') + '\n';
}
