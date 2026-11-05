// Unmeta Telegram bot, for groups only (private chats are ignored): a clean button under each file, or /clean as a reply.
// Always the Maximum preset. Talks to a local Bot API server (files up to 2 GB, read and sent by path). Keeps nothing.
import { readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clean, kindOf, fileFromPath, workDir, DiskFile, WORK, PRESETS, CATEGORIES } from './engine';
import { esc, fileUri, mediaOf, offerable, type Item } from './chat';
import ruCopy from '../copy/ru.json';
import enCopy from '../copy/en.json';

const TOKEN = process.env.BOT_TOKEN ?? '';
const API = `${process.env.BOT_API ?? 'http://127.0.0.1:8081'}/bot${TOKEN}`;
const MAX_BYTES = 2000 * 1024 ** 2; // local Bot API limit
const MAX_IN_MEMORY = 300 * 1024 ** 2; // photos and documents are cleaned in memory (1 GB server)

// ---------- texts ----------
const T = {
  ru: {
    start: 'Отправьте в группу файл — фото, видео, аудио, PDF или документ — и я верну его без скрытых данных: геопозиции, модели телефона, дат, автора, истории правок.\n\nОтправляйте как <b>файл</b>, а не как фото: так Telegram не пережмёт его.\n\nПод файлом появится кнопка очистки. Ещё можно ответить на сообщение с файлом командой <code>/clean</code>.\n\nФайл скачивается на сервер бота только когда вы просите, и удаляется сразу после ответа. Другие сообщения группы бот не читает и не хранит. Если нужно, чтобы файл совсем не покидал устройство, — сайт: https://unmeta.nolim.cloud',
    queued: 'В очереди, перед вами: {n}',
    downloading: 'Получаю файл…',
    cleaning: 'Чищу…',
    cleaningPct: 'Чищу… {p}%',
    removed: 'Удалено: {list}',
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
    offer: 'В файле <b>{name}</b> могут быть скрытые данные.',
    btnClean: 'Очистить от метаданных',
    gone: 'Сообщение с файлом уже удалено.',
  },
  en: {
    start: 'Send a file to the group — photo, video, audio, PDF or document — and I will return it without hidden data: location, phone model, dates, author, edit history.\n\nSend it as a <b>file</b>, not as a photo, so Telegram does not recompress it.\n\nA clean button appears under each file. You can also reply to a file with <code>/clean</code>.\n\nA file reaches the bot\'s server only when you ask, and is deleted right after the reply. The bot neither reads nor keeps other group messages. If the file must never leave your device, use the site: https://unmeta.nolim.cloud',
    queued: 'Queued, ahead of you: {n}',
    downloading: 'Getting the file…',
    cleaning: 'Cleaning…',
    cleaningPct: 'Cleaning… {p}%',
    removed: 'Removed: {list}',
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
    offer: '<b>{name}</b> may contain hidden data.',
    btnClean: 'Remove metadata',
    gone: 'The message with the file is gone.',
  },
};
type Lang = keyof typeof T;
const COPY = { ru: ruCopy, en: enCopy };
const lang = (u?: { language_code?: string }): Lang => (u?.language_code?.startsWith('ru') ? 'ru' : 'en');
const fmt = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const catName = (l: Lang, c: string) => (COPY[l].categories as Record<string, { name: string }>)[c]?.name ?? c;

// ---------- Bot API ----------
async function tg<R = any>(method: string, params: object = {}): Promise<R> {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
  const j = await r.json() as { ok: boolean; result: R; description?: string };
  if (!j.ok) throw new Error(`${method}: ${j.description}`);
  return j.result;
}
const say = (chat: number, text: string, reply?: number, extra: object = {}) =>
  tg<{ message_id: number }>('sendMessage', { chat_id: chat, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(reply ? { reply_parameters: { message_id: reply, allow_sending_without_reply: true } } : {}), ...extra });
const edit = (chat: number, id: number, text: string, extra: object = {}) => tg('editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML', ...extra }).catch(() => {}); // no reply_markup = buttons gone
const drop = (chat: number, id: number) => tg('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {});

// ---------- the work: one file at a time (the engine is serial anyway) ----------
// ponytail: one global queue; per-chat fairness when the bot serves more than a few chats
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;
const busy = new Set<number>(); // status messages being worked on: a double tap must not run a job twice
type Job = { chat: number; reply: number; l: Lang; item: Item; status?: number };
const offerKeyboard = (l: Lang) => ({ inline_keyboard: [[{ text: T[l].btnClean, callback_data: 'file:clean' }]] });
// Jobs run one at a time, so everything in the work folder belongs to the job that just ended (even if it failed).
const sweep = async () => { for (const n of await readdir(WORK).catch(() => [] as string[])) if (n.startsWith('job-')) await rm(join(WORK, n), { recursive: true, force: true }); };

function enqueue(job: Job) {
  const { chat, reply, l, item } = job;
  if (job.status) { if (busy.has(job.status)) return; busy.add(job.status); }
  if ((item.media.file_size ?? 0) > MAX_BYTES) {
    if (job.status) { busy.delete(job.status); void edit(chat, job.status, T[l].tooBig); } else void say(chat, T[l].tooBig, reply);
    return;
  }
  const ahead = waiting++;
  const wait = ahead ? fmt(T[l].queued, { n: ahead }) : T[l].downloading;
  const status = job.status ? edit(chat, job.status, wait).then(() => ({ message_id: job.status! })) : say(chat, wait, reply);
  chain = chain.then(async () => {
    waiting--;
    const st = (await status.catch(() => null))?.message_id;
    try { await work(job, st); }
    catch (e) {
      console.error('job failed:', e instanceof Error ? e.message : e); // no file names or contents in logs
      const msg = String(e);
      await say(chat, /unsupported|no-av-streams/.test(msg) ? T[l].unsupported : /Error opening|Invalid data|corrupt|not a valid|truncated/i.test(msg) ? T[l].corrupt : T[l].failed, reply);
    } finally {
      if (st) await drop(chat, st);
      if (job.status) busy.delete(job.status);
      await sweep();
    }
  });
}

async function work({ chat, reply, l, item }: Job, st?: number) {
  if (st) await edit(chat, st, T[l].downloading);
  const { file_path: input } = await tg<{ file_path: string }>('getFile', { file_id: item.media.file_id });
  try {
    const file = await fileFromPath(input, item.name);
    const kind = await kindOf(file);
    if (kind === 'unsupported') return void await say(chat, T[l].unsupported, reply);
    if (kind === 'text') return void await say(chat, T[l].text, reply);
    if (kind !== 'av' && file.size > MAX_IN_MEMORY) return void await say(chat, T[l].tooBigDoc, reply);
    if (st) await edit(chat, st, T[l].cleaning);
    let last = 0;
    const r = await clean(file, PRESETS.max, (p) => {
      if (st && Date.now() - last > 3000) { last = Date.now(); void edit(chat, st, fmt(T[l].cleaningPct, { p: Math.round(p * 100) })); }
    });
    const found = CATEGORIES.filter((c) => r.before.found[c]);
    if (!found.length) return void await say(chat, item.photo ? T[l].photoNote : T[l].nothing, reply);
    const out = join(await workDir(), r.name);
    if (r.blob instanceof DiskFile) await rename(r.blob.path, out); else await writeFile(out, new Uint8Array(await r.blob.arrayBuffer()));
    const left = r.notes.filter((n) => n.startsWith('raw-kept:')).flatMap((n) => n.slice(9).split(','));
    const removed = found.filter((c) => !left.includes(c));
    const caption = [
      removed.length ? fmt(T[l].removed, { list: removed.map((c) => catName(l, c)).join(', ') }) : '',
      left.length ? fmt(T[l].leftover, { list: [...new Set(left)].map((c) => catName(l, c)).join(', ') }) : '',
    ].filter(Boolean).join('\n');
    await tg('sendDocument', { chat_id: chat, document: fileUri(out), caption, disable_content_type_detection: true, reply_parameters: { message_id: reply, allow_sending_without_reply: true } });
  } finally {
    await unlink(input).catch(() => {}); // the Bot API server's copy of the original
  }
}

// ---------- updates ----------
let me = '';

async function onMessage(m: any) {
  if (m.chat.type === 'private') return; // groups only
  const chat = m.chat.id, l = lang(m.from);
  const text: string = m.text ?? m.caption ?? '';
  const cmd = text.match(/^\/(\w+)(@\w+)?/);
  if (cmd?.[2] && cmd[2].slice(1).toLowerCase() !== me.toLowerCase()) return; // a command for another bot
  if (cmd?.[1] === 'start' || cmd?.[1] === 'help') return void await say(chat, T[l].start);
  if (cmd?.[1] !== 'clean') { // privacy mode off: every group message lands here, and only a file's name and type are looked at
    if (offerable(m)) await say(chat, fmt(T[l].offer, { name: esc(mediaOf(m)!.name) }), m.message_id, { reply_markup: offerKeyboard(l) });
    return;
  }
  const own = mediaOf(m), item = own ?? (m.reply_to_message ? mediaOf(m.reply_to_message) : null);
  if (!item) return void await say(chat, T[l].replyToFile, m.message_id);
  enqueue({ chat, reply: own ? m.message_id : m.reply_to_message.message_id, l, item });
}

async function onCallback(q: any) {
  const l = lang(q.from), m = q.message;
  const ours = q.data === 'file:clean' && m?.chat.type !== 'private'; // an old view or mode button does nothing
  const item = ours && m?.reply_to_message ? mediaOf(m.reply_to_message) : null; // the button replies to the file: no state to keep
  await tg('answerCallbackQuery', { callback_query_id: q.id, ...(ours && !item ? { text: T[l].gone } : {}) });
  if (item) enqueue({ chat: m.chat.id, reply: m.reply_to_message.message_id, l, item, status: m.message_id });
}

async function main() {
  if (!TOKEN) throw new Error('BOT_TOKEN is not set');
  await sweep(); // left by a crash or a restart
  me = (await tg<{ username: string }>('getMe')).username;
  await tg('deleteMyCommands'); // the list once shown in private chats
  for (const [l, code] of [['ru', 'ru'], ['en', '']] as const) {
    await tg('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
      { command: 'start', description: l === 'ru' ? 'Как пользоваться' : 'How to use' },
      { command: 'clean', description: l === 'ru' ? 'Очистить файл (ответом на сообщение)' : 'Clean a file (as a reply)' },
    ], ...(code ? { language_code: code } : {}) });
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
