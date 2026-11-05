// What the bot decides from a Telegram message alone, before touching any file.
import { ext, RAW, OFFICE } from '../src/engine/detect.ts';

export type Media = { file_id: string; file_size?: number; file_name?: string; mime_type?: string; duration?: number; width?: number; height?: number; length?: number };
/** How it arrived: it leaves the same way, so the clean copy looks like what the person sent. */
export type Shape = { type: 'document' | 'video' | 'audio' | 'animation' | 'voice' | 'video_note'; duration?: number; width?: number; height?: number; length?: number };
export type Item = { media: Media; name: string; photo: boolean; shape: Shape };

const MAX_BYTES = 2000 * 1024 ** 2; // local Bot API limit
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' };
// By name and type only: nothing is downloaded until someone presses a button. Text formats stay out: nowhere to hide data.
const MEDIA = /^(jpe?g|png|gif|webp|hei[cf]|avif|tiff?|psd|psb|pdf|svg|mp4|m4v|mov|qt|mkv|webm|avi|wmv|asf|3gp|3g2|mts|m2ts|mpg|mpeg|vob|mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|aiff?|wma)$/;

export function mediaOf(m: any): Item | null {
  if (m.photo?.length) return { media: m.photo.at(-1), name: 'photo.jpg', photo: true, shape: { type: 'document' } }; // sendPhoto would recompress
  const media: Media | undefined = m.document ?? m.video ?? m.audio ?? m.animation ?? m.voice ?? m.video_note;
  if (!media) return null;
  const e = EXT[media.mime_type ?? ''] ?? media.mime_type?.split('/')[1] ?? 'bin';
  const type = m.video ? 'video' : m.audio ? 'audio' : m.animation ? 'animation' : m.voice ? 'voice' : m.video_note ? 'video_note' : 'document';
  const { duration, width, height, length } = media;
  return { media, name: media.file_name ?? `${m.voice ? 'voice' : m.audio ? 'audio' : 'video'}.${e}`, photo: false, shape: { type, duration, width, height, length } };
}

/** The Bot API call that sends a local file the way it arrived. */
export function sendCall(shape: Shape, file: string, thumb: string | null, caption: string): { method: string; params: object } {
  const uri = fileUri(file), preview = thumb ? { thumbnail: fileUri(thumb) } : {};
  const size = { duration: shape.duration, width: shape.width, height: shape.height };
  switch (shape.type) {
    case 'video': return { method: 'sendVideo', params: { video: uri, ...size, ...preview, supports_streaming: true, caption } };
    case 'animation': return { method: 'sendAnimation', params: { animation: uri, ...size, ...preview, caption } };
    case 'audio': return { method: 'sendAudio', params: { audio: uri, duration: shape.duration, ...preview, caption } };
    case 'voice': return { method: 'sendVoice', params: { voice: uri, duration: shape.duration, caption } };
    case 'video_note': return { method: 'sendVideoNote', params: { video_note: uri, duration: shape.duration, length: shape.length, ...preview } }; // takes no caption
    default: return { method: 'sendDocument', params: { document: uri, ...preview, caption, disable_content_type_detection: true } };
  }
}

/** Should the bot offer its button under this group message? Everything that can carry metadata, compressed or not. */
export function offerable(m: any): boolean {
  if (m.is_automatic_forward || (m.from?.is_bot && !m.sender_chat)) return false; // channel reposts, other bots; anonymous admins are people
  const item = mediaOf(m);
  if (!item || (item.media.file_size ?? 0) > MAX_BYTES) return false;
  if (!m.document) return true; // photo, video, audio, GIF, voice, round video: all of them may carry data
  const name = item.media.file_name ?? '';
  if (/_clean\.\w+$/i.test(name)) return false; // already ours
  const e = ext(name);
  return e ? MEDIA.test(e) || RAW.test(e) || OFFICE.test(e) : /^(video|audio|image)\/|^application\/pdf$/.test(item.media.mime_type ?? '');
}

const bytes = (s: string) => Buffer.byteLength(s);
/** A name the disk accepts (255 bytes at most) that still looks like the original. */
export function safeName(name: string): string {
  const clean = name.replace(/[/\\\0-\x1f\x7f]/g, '_').replace(/^\.+/, '').trim() || 'file';
  const tail = clean.match(/(_clean)?(\.[^.\s]{1,15})?$/)![0]; // the end of the name is the promise: "_clean.mp4" survives any trim
  let head = [...clean.slice(0, clean.length - tail.length)];
  while (bytes(head.join('')) + bytes(tail) > 200) head.pop();
  return (head.join('').trimEnd() || 'file') + tail;
}

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The Bot API URL-decodes local paths: "100%.mp4" would point nowhere unencoded. */
export const fileUri = (path: string) => `file://${path.split('/').map(encodeURIComponent).join('/')}`;
