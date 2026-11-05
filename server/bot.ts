// Unmeta Telegram bot: send a file (private chat) or reply /clean to one (group) → the same file without metadata.
// Talks to a local Bot API server (files up to 2 GB, read and sent by path). Keeps nothing but each user's mode.
import { readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { clean, kindOf, fileFromPath, workDir, DiskFile, PRESETS, CATEGORIES, type PresetId } from './engine';
import ruCopy from '../copy/ru.json';
import enCopy from '../copy/en.json';

const TOKEN = process.env.BOT_TOKEN ?? '';
const API = `${process.env.BOT_API ?? 'http://127.0.0.1:8081'}/bot${TOKEN}`;
const SETTINGS = process.env.SETTINGS_FILE ?? join(process.env.WORK_DIR ?? '/tmp/unmeta', 'settings.json');
const MAX_BYTES = 2000 * 1024 ** 2; // local Bot API limit
const MAX_IN_MEMORY = 300 * 1024 ** 2; // photos and documents are cleaned in memory (1 GB server)

// ---------- texts ----------
const T = {
  ru: {
    start: 'Пришлите файл — фото, видео, аудио, PDF или документ — и я верну его без скрытых данных: геопозиции, модели телефона, дат, автора, истории правок.\n\nОтправляйте как <b>файл</b>, а не как фото: так Telegram не пережмёт его.\n\nВ группе ответьте <code>/clean</code> на сообщение с файлом.\n\nРежим очистки: /mode\n\nФайлы проходят через сервер бота и удаляются сразу после ответа. Если нужно, чтобы файл совсем не покидал устройство, — сайт: https://unmeta.nolim.cloud',
    mode: 'Режим очистки сейчас: <b>{mode}</b>. Выберите:',
    modeSet: 'Режим: <b>{mode}</b>',
    queued: 'В очереди, перед вами: {n}',
    downloading: 'Получаю файл…',
    cleaning: 'Чищу…',
    cleaningPct: 'Чищу… {p}%',
    removed: 'Удалено: {list}',
    kept: 'Оставлено по режиму: {list}',
    leftover: 'Не получилось убрать: {list}',
    nothing: 'Скрытых данных нет — файл уже чистый, можно отправлять как есть.',
    photoNote: 'Это фото Telegram уже пережал и очистил сам. Чтобы сохранить качество, отправляйте фото как файл.',
    text: 'В текстовых файлах негде прятать сведения о вас. Проверьте только сам текст.',
    unsupported: 'Этот формат я пока не умею чистить. С файлом всё в порядке — я его не трогал.',
    tooBig: 'Файл больше 2 ГБ — Telegram не даст мне его скачать.',
    tooBigDoc: 'Такой большой документ или фото я пока не потяну. Попробуйте сайт: https://unmeta.nolim.cloud',
    failed: 'Не получилось очистить этот файл. Не отправляйте его как чистый.',
    corrupt: 'Не получилось открыть файл — возможно, он повреждён.',
    replyToFile: 'Ответьте /clean на сообщение с файлом.',
  },
  en: {
    start: 'Send me a file — photo, video, audio, PDF or document — and I will return it without hidden data: location, phone model, dates, author, edit history.\n\nSend it as a <b>file</b>, not as a photo, so Telegram does not recompress it.\n\nIn a group, reply <code>/clean</code> to a message with a file.\n\nCleaning mode: /mode\n\nFiles pass through the bot\'s server and are deleted right after the reply. If the file must never leave your device, use the site: https://unmeta.nolim.cloud',
    mode: 'Cleaning mode now: <b>{mode}</b>. Choose:',
    modeSet: 'Mode: <b>{mode}</b>',
    queued: 'Queued, ahead of you: {n}',
    downloading: 'Getting the file…',
    cleaning: 'Cleaning…',
    cleaningPct: 'Cleaning… {p}%',
    removed: 'Removed: {list}',
    kept: 'Kept by mode: {list}',
    leftover: 'Could not remove: {list}',
    nothing: 'No hidden data — the file is already clean, send it as is.',
    photoNote: 'Telegram already recompressed and stripped this photo. To keep quality, send photos as files.',
    text: 'Plain text has nowhere to hide data about you. Just check the text itself.',
    unsupported: 'I can\'t clean this format yet. Your file is fine — I didn\'t touch it.',
    tooBig: 'The file is over 2 GB — Telegram won\'t let me download it.',
    tooBigDoc: 'This document or photo is too big for me yet. Try the site: https://unmeta.nolim.cloud',
    failed: 'Couldn\'t clean this file. Don\'t share it as clean.',
    corrupt: 'Couldn\'t open the file — it may be damaged.',
    replyToFile: 'Reply /clean to a message with a file.',
  },
};
type Lang = keyof typeof T;
const COPY = { ru: ruCopy, en: enCopy };
const MODE_KEY: Record<PresetId, 'maximum' | 'balanced' | 'privateOnly'> = { max: 'maximum', balanced: 'balanced', private: 'privateOnly' };
const lang = (u?: { language_code?: string }): Lang => (u?.language_code?.startsWith('ru') ? 'ru' : 'en');
const fmt = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const catName = (l: Lang, c: string) => (COPY[l].categories as Record<string, { name: string }>)[c]?.name ?? c;
const modeName = (l: Lang, p: PresetId) => COPY[l].modes[MODE_KEY[p]].name;

// ---------- settings (the only thing stored: each user's mode) ----------
let modes: Record<string, PresetId> = {};
try { modes = JSON.parse(await readFile(SETTINGS, 'utf8')); } catch { /* first run */ }
const modeOf = (id: number): PresetId => modes[id] ?? 'max';
const setMode = async (id: number, p: PresetId) => { modes[id] = p; await writeFile(SETTINGS, JSON.stringify(modes)); };

// ---------- Bot API ----------
async function tg<R = any>(method: string, params: object = {}): Promise<R> {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  const j = await r.json() as { ok: boolean; result: R; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
const say = (chat: number, text: string, reply?: number, extra: object = {}) =>
  tg<{ message_id: number }>('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply ? { reply_parameters: { message_id: reply, allow_sending_without_reply: true } } : {}), ...extra });
const edit = (chat: number, id: number, text: string) => tg('editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML' }).catch(() => {});
const drop = (chat: number, id: number) => tg('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {});

type Media = { file_id: string; file_size?: number; file_name?: string; mime_type?: string };
const EXT: Record<string, string> = { 'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a' };
function mediaOf(m: any): { media: Media; name: string; photo: boolean } | null {
  if (m.photo) return { media: m.photo.at(-1), name: 'photo.jpg', photo: true };
  const media: Media | undefined = m.document ?? m.video ?? m.audio ?? m.animation ?? m.voice ?? m.video_note;
  if (!media) return null;
  const e = EXT[media.mime_type ?? ''] ?? media.mime_type?.split('/')[1] ?? 'bin';
  return { media, name: media.file_name ?? `${m.voice ? 'voice' : m.audio ? 'audio' : 'video'}.${e}`, photo: false };
}

// ---------- the work: one file at a time (the engine is serial anyway) ----------
// ponytail: one global queue; per-chat fairness when the bot serves more than a few chats
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;

function enqueue(chat: number, reply: number, l: Lang, user: number, item: NonNullable<ReturnType<typeof mediaOf>>) {
  if ((item.media.file_size ?? 0) > MAX_BYTES) { void say(chat, T[l].tooBig, reply); return; }
  const ahead = waiting++;
  const status = say(chat, ahead ? fmt(T[l].queued, { n: ahead }) : T[l].downloading, reply);
  chain = chain.then(async () => {
    waiting--;
    const st = (await status.catch(() => null))?.message_id;
    try { await work(chat, reply, l, user, item, st); }
    catch (e) {
      console.error('job failed:', e instanceof Error ? e.message : e); // no file names or contents in logs
      const msg = String(e);
      await say(chat, /unsupported|no-av-streams/.test(msg) ? T[l].unsupported : /Error opening|Invalid data|corrupt|not a valid|truncated/i.test(msg) ? T[l].corrupt : T[l].failed, reply);
    } finally { if (st) await drop(chat, st); }
  });
}

async function work(chat: number, reply: number, l: Lang, user: number, item: NonNullable<ReturnType<typeof mediaOf>>, st?: number) {
  if (st) await edit(chat, st, T[l].downloading);
  const { file_path: input } = await tg<{ file_path: string }>('getFile', { file_id: item.media.file_id });
  const dir = await workDir();
  try {
    const file = await fileFromPath(input, item.name);
    const kind = await kindOf(file);
    if (kind === 'unsupported') return void await say(chat, T[l].unsupported, reply);
    if (kind === 'text') return void await say(chat, T[l].text, reply);
    if (kind !== 'av' && file.size > MAX_IN_MEMORY) return void await say(chat, T[l].tooBigDoc, reply);
    if (st) await edit(chat, st, T[l].cleaning);
    const keep = PRESETS[modeOf(user)];
    let last = 0;
    const r = await clean(file, keep, (p) => {
      if (st && Date.now() - last > 3000) { last = Date.now(); void edit(chat, st, fmt(T[l].cleaningPct, { p: Math.round(p * 100) })); }
    });
    const found = CATEGORIES.filter((c) => r.before.found[c]);
    if (!found.length) return void await say(chat, item.photo ? T[l].photoNote : T[l].nothing, reply);
    const out = join(dir, r.name);
    if (r.blob instanceof DiskFile) await rename(r.blob.path, out); else await writeFile(out, new Uint8Array(await r.blob.arrayBuffer()));
    const left = r.notes.filter((n) => n.startsWith('raw-kept:')).flatMap((n) => n.slice(9).split(','));
    const removed = found.filter((c) => !keep.includes(c) && !left.includes(c));
    const kept = found.filter((c) => keep.includes(c));
    const caption = [
      removed.length ? fmt(T[l].removed, { list: removed.map((c) => catName(l, c)).join(', ') }) : '',
      kept.length ? fmt(T[l].kept, { list: kept.map((c) => catName(l, c)).join(', ') }) : '',
      left.length ? fmt(T[l].leftover, { list: [...new Set(left)].map((c) => catName(l, c)).join(', ') }) : '',
    ].filter(Boolean).join('\n');
    await tg('sendDocument', { chat_id: chat, document: `file://${out}`, caption, disable_content_type_detection: true, reply_parameters: { message_id: reply, allow_sending_without_reply: true } });
    if (r.blob instanceof DiskFile) await rm(dirname(r.blob.path), { recursive: true, force: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
    await unlink(input).catch(() => {}); // the Bot API server's copy of the original
  }
}

// ---------- updates ----------
const modeKeyboard = (l: Lang, cur: PresetId) => ({
  inline_keyboard: (Object.keys(PRESETS) as PresetId[]).map((p) => [{ text: `${p === cur ? '● ' : ''}${modeName(l, p)}`, callback_data: `mode:${p}` }]),
});
let me = '';

async function onMessage(m: any) {
  const chat = m.chat.id, l = lang(m.from), user = m.from?.id ?? chat;
  const text: string = m.text ?? m.caption ?? '';
  const cmd = text.match(/^\/(\w+)(@\w+)?/);
  if (cmd?.[2] && cmd[2].slice(1).toLowerCase() !== me.toLowerCase()) return; // a command for another bot
  const group = m.chat.type !== 'private';
  if (cmd?.[1] === 'start' || cmd?.[1] === 'help') return void await say(chat, T[l].start);
  if (cmd?.[1] === 'mode') return void await say(chat, fmt(T[l].mode, { mode: modeName(l, modeOf(user)) }), m.message_id, { reply_markup: modeKeyboard(l, modeOf(user)) });
  if (group && cmd?.[1] !== 'clean') return; // in groups: only on /clean
  const own = mediaOf(m), item = own ?? (m.reply_to_message ? mediaOf(m.reply_to_message) : null);
  if (!item) return void await say(chat, group ? T[l].replyToFile : T[l].start, m.message_id);
  enqueue(chat, own ? m.message_id : m.reply_to_message.message_id, l, user, item);
}

async function onCallback(q: any) {
  const p = q.data?.replace(/^mode:/, '') as PresetId;
  const l = lang(q.from);
  if (!(p in PRESETS)) return void await tg('answerCallbackQuery', { callback_query_id: q.id });
  await setMode(q.from.id, p);
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: fmt(T[l].modeSet, { mode: modeName(l, p) }).replace(/<\/?b>/g, '') });
  if (q.message) await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: fmt(T[l].modeSet, { mode: modeName(l, p) }), parse_mode: 'HTML', reply_markup: modeKeyboard(l, p) }).catch(() => {});
}

async function main() {
  if (!TOKEN) throw new Error('BOT_TOKEN is not set');
  me = (await tg<{ username: string }>('getMe')).username;
  for (const [l, scope] of [['ru', 'ru'], ['en', '']] as const) {
    await tg('setMyCommands', { commands: [
      { command: 'start', description: l === 'ru' ? 'Как пользоваться' : 'How to use' },
      { command: 'mode', description: l === 'ru' ? 'Режим очистки' : 'Cleaning mode' },
      { command: 'clean', description: l === 'ru' ? 'Очистить файл (ответом на сообщение)' : 'Clean a file (as a reply)' },
    ], ...(scope ? { language_code: scope } : {}) });
  }
  console.log(`@${me} ready`);
  for (let offset = 0; ;) {
    let updates: any[] = [];
    try { updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }); }
    catch (e) { console.error('getUpdates:', e instanceof Error ? e.message : e); await new Promise((r) => setTimeout(r, 5000)); continue; }
    for (const u of updates) {
      offset = u.update_id + 1;
      try { if (u.message) await onMessage(u.message); else if (u.callback_query) await onCallback(u.callback_query); }
      catch (e) { console.error('update failed:', e instanceof Error ? e.message : e); }
    }
  }
}

void main().catch((e) => { console.error(e); process.exit(1); });
