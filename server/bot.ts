// Unmeta Telegram bot, for groups only (private chats are ignored): buttons under each file, or /clean and /meta as a reply.
// Talks to a local Bot API server (files up to 2 GB, read and sent by path). Keeps nothing but each user's mode.
import { readdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { clean, inspect, kindOf, fileFromPath, workDir, DiskFile, WORK, PRESETS, CATEGORIES, type PresetId } from './engine';
import { allFields, esc, fileUri, mediaOf, metaText, offerable, type Item } from './chat';
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
    start: 'Отправьте в группу файл — фото, видео, аудио, PDF или документ — и я верну его без скрытых данных: геопозиции, модели телефона, дат, автора, истории правок.\n\nОтправляйте как <b>файл</b>, а не как фото: так Telegram не пережмёт его.\n\nПод файлом появятся кнопки. Ещё можно ответить на сообщение с файлом командой <code>/clean</code> (очистить) или <code>/meta</code> (посмотреть, что внутри).\n\nРежим очистки: /mode\n\nФайл скачивается на сервер бота только когда вы просите, и удаляется сразу после ответа. Другие сообщения группы бот не читает и не хранит. Если нужно, чтобы файл совсем не покидал устройство, — сайт: https://unmeta.nolim.cloud',
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
    replyToFile: 'Ответьте /clean или /meta на сообщение с файлом.',
    offer: 'В файле <b>{name}</b> могут быть скрытые данные.',
    btnClean: 'Очистить от метаданных',
    btnMeta: 'Посмотреть метаданные',
    btnAll: 'Все поля файлом',
    more: '…и ещё {n}',
    reading: 'Смотрю, что внутри…',
    metaTitle: 'Что нашлось в файле:',
    found: 'есть',
    gone: 'Сообщение с файлом уже удалено.',
  },
  en: {
    start: 'Send a file to the group — photo, video, audio, PDF or document — and I will return it without hidden data: location, phone model, dates, author, edit history.\n\nSend it as a <b>file</b>, not as a photo, so Telegram does not recompress it.\n\nButtons appear under each file. You can also reply to a file with <code>/clean</code> (clean it) or <code>/meta</code> (see what is inside).\n\nCleaning mode: /mode\n\nA file reaches the bot\'s server only when you ask, and is deleted right after the reply. The bot neither reads nor keeps other group messages. If the file must never leave your device, use the site: https://unmeta.nolim.cloud',
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
    replyToFile: 'Reply /clean or /meta to a message with a file.',
    offer: '<b>{name}</b> may contain hidden data.',
    btnClean: 'Remove metadata',
    btnMeta: 'View metadata',
    btnAll: 'All fields as a file',
    more: '…and {n} more',
    reading: 'Looking inside…',
    metaTitle: 'Found in this file:',
    found: 'present',
    gone: 'The message with the file is gone.',
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
const edit = (chat: number, id: number, text: string, extra: object = {}) => tg('editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML', ...extra }).catch(() => {}); // no reply_markup = buttons gone
const drop = (chat: number, id: number) => tg('deleteMessage', { chat_id: chat, message_id: id }).catch(() => {});

// ---------- the work: one file at a time (the engine is serial anyway) ----------
// ponytail: one global queue; per-chat fairness when the bot serves more than a few chats
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;
const busy = new Set<number>(); // status messages being worked on: a double tap must not run a job twice
type Job = { action: 'clean' | 'meta' | 'all'; chat: number; reply: number; l: Lang; user: number; item: Item; status?: number };
const offerKeyboard = (l: Lang, buttons: Job['action'][] = ['clean', 'meta']) => ({
  inline_keyboard: buttons.map((a) => [{ text: a === 'clean' ? T[l].btnClean : a === 'all' ? T[l].btnAll : T[l].btnMeta, callback_data: `file:${a}` }]),
});
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
    let keep = false;
    try { keep = await work(job, st); }
    catch (e) {
      console.error('job failed:', e instanceof Error ? e.message : e); // no file names or contents in logs
      const msg = String(e);
      await say(chat, /unsupported|no-av-streams/.test(msg) ? T[l].unsupported : /Error opening|Invalid data|corrupt|not a valid|truncated/i.test(msg) ? T[l].corrupt : T[l].failed, reply);
    } finally {
      if (st && !keep) await drop(chat, st);
      if (job.status) busy.delete(job.status);
      await sweep();
    }
  });
}

/** True = the status message now holds the answer: leave it in the chat. */
async function work({ action, chat, reply, l, user, item }: Job, st?: number): Promise<boolean> {
  if (st) await edit(chat, st, T[l].downloading);
  const { file_path: input } = await tg<{ file_path: string }>('getFile', { file_id: item.media.file_id });
  try {
    const file = await fileFromPath(input, item.name);
    const kind = await kindOf(file);
    if (kind === 'unsupported') return void await say(chat, T[l].unsupported, reply), false;
    if (kind === 'text') return void await say(chat, T[l].text, reply), false;
    if (kind !== 'av' && file.size > MAX_IN_MEMORY) return void await say(chat, T[l].tooBigDoc, reply), false;
    if (action !== 'clean') {
      if (st) await edit(chat, st, T[l].reading);
      const { found, tags } = await inspect(file, kind);
      const cats = CATEGORIES.filter((c) => found[c]);
      if (!cats.length) return void await say(chat, item.photo ? T[l].photoNote : T[l].nothing, reply), false;
      const text = metaText(T[l].metaTitle, cats, found, (c) => catName(l, c), T[l].found, (n) => fmt(T[l].more, { n }));
      if (st) await edit(chat, st, text, { reply_markup: offerKeyboard(l, action === 'all' ? ['clean'] : ['clean', 'all']) }); else await say(chat, text, reply);
      if (action === 'all') {
        const list = join(await workDir(), `${item.name.replace(/\.[^.]*$/, '')}_metadata.txt`);
        await writeFile(list, allFields(tags, found, T[l].found));
        await tg('sendDocument', { chat_id: chat, document: fileUri(list), disable_content_type_detection: true, reply_parameters: { message_id: reply, allow_sending_without_reply: true } });
      }
      return !!st;
    }
    if (st) await edit(chat, st, T[l].cleaning);
    const keep = PRESETS[modeOf(user)];
    let last = 0;
    const r = await clean(file, keep, (p) => {
      if (st && Date.now() - last > 3000) { last = Date.now(); void edit(chat, st, fmt(T[l].cleaningPct, { p: Math.round(p * 100) })); }
    });
    const found = CATEGORIES.filter((c) => r.before.found[c]);
    if (!found.length) return void await say(chat, item.photo ? T[l].photoNote : T[l].nothing, reply), false;
    const out = join(await workDir(), r.name);
    if (r.blob instanceof DiskFile) await rename(r.blob.path, out); else await writeFile(out, new Uint8Array(await r.blob.arrayBuffer()));
    const left = r.notes.filter((n) => n.startsWith('raw-kept:')).flatMap((n) => n.slice(9).split(','));
    const removed = found.filter((c) => !keep.includes(c) && !left.includes(c));
    const kept = found.filter((c) => keep.includes(c));
    const caption = [
      removed.length ? fmt(T[l].removed, { list: removed.map((c) => catName(l, c)).join(', ') }) : '',
      kept.length ? fmt(T[l].kept, { list: kept.map((c) => catName(l, c)).join(', ') }) : '',
      left.length ? fmt(T[l].leftover, { list: [...new Set(left)].map((c) => catName(l, c)).join(', ') }) : '',
    ].filter(Boolean).join('\n');
    await tg('sendDocument', { chat_id: chat, document: fileUri(out), caption, disable_content_type_detection: true, reply_parameters: { message_id: reply, allow_sending_without_reply: true } });
    return false;
  } finally {
    await unlink(input).catch(() => {}); // the Bot API server's copy of the original
  }
}

// ---------- updates ----------
const modeKeyboard = (l: Lang, cur: PresetId) => ({
  inline_keyboard: (Object.keys(PRESETS) as PresetId[]).map((p) => [{ text: `${p === cur ? '● ' : ''}${modeName(l, p)}`, callback_data: `mode:${p}` }]),
});
let me = '';

async function onMessage(m: any) {
  if (m.chat.type === 'private') return; // groups only
  const chat = m.chat.id, l = lang(m.from), user = m.from?.id ?? chat;
  const text: string = m.text ?? m.caption ?? '';
  const cmd = text.match(/^\/(\w+)(@\w+)?/);
  if (cmd?.[2] && cmd[2].slice(1).toLowerCase() !== me.toLowerCase()) return; // a command for another bot
  if (cmd?.[1] === 'start' || cmd?.[1] === 'help') return void await say(chat, T[l].start);
  if (cmd?.[1] === 'mode') return void await say(chat, fmt(T[l].mode, { mode: modeName(l, modeOf(user)) }), m.message_id, { reply_markup: modeKeyboard(l, modeOf(user)) });
  const action = cmd?.[1] === 'clean' || cmd?.[1] === 'meta' ? cmd[1] : null;
  if (!action) { // privacy mode off: every group message lands here, and only a file's name and type are looked at
    if (offerable(m)) await say(chat, fmt(T[l].offer, { name: esc(mediaOf(m)!.name) }), m.message_id, { reply_markup: offerKeyboard(l) });
    return;
  }
  const own = mediaOf(m), item = own ?? (m.reply_to_message ? mediaOf(m.reply_to_message) : null);
  if (!item) return void await say(chat, T[l].replyToFile, m.message_id);
  enqueue({ action, chat, reply: own ? m.message_id : m.reply_to_message.message_id, l, user, item });
}

async function onCallback(q: any) {
  if (q.message?.chat.type === 'private') return void await tg('answerCallbackQuery', { callback_query_id: q.id }); // groups only
  const l = lang(q.from);
  const [kind, value] = String(q.data ?? '').split(':');
  if (kind === 'file' && (value === 'clean' || value === 'meta' || value === 'all')) {
    const m = q.message, item = m?.reply_to_message ? mediaOf(m.reply_to_message) : null; // the buttons reply to the file: no state to keep
    await tg('answerCallbackQuery', { callback_query_id: q.id, ...(item ? {} : { text: T[l].gone }) });
    if (item) enqueue({ action: value, chat: m.chat.id, reply: m.reply_to_message.message_id, l, user: q.from.id, item, status: m.message_id });
    return;
  }
  const p = value as PresetId;
  if (kind !== 'mode' || !(p in PRESETS)) return void await tg('answerCallbackQuery', { callback_query_id: q.id });
  await setMode(q.from.id, p);
  await tg('answerCallbackQuery', { callback_query_id: q.id, text: fmt(T[l].modeSet, { mode: modeName(l, p) }).replace(/<\/?b>/g, '') });
  if (q.message) await tg('editMessageText', { chat_id: q.message.chat.id, message_id: q.message.message_id, text: fmt(T[l].modeSet, { mode: modeName(l, p) }), parse_mode: 'HTML', reply_markup: modeKeyboard(l, p) }).catch(() => {});
}

async function main() {
  if (!TOKEN) throw new Error('BOT_TOKEN is not set');
  await sweep(); // left by a crash or a restart
  me = (await tg<{ username: string }>('getMe')).username;
  await tg('deleteMyCommands'); // the list once shown in private chats
  for (const [l, code] of [['ru', 'ru'], ['en', '']] as const) {
    await tg('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
      { command: 'start', description: l === 'ru' ? 'Как пользоваться' : 'How to use' },
      { command: 'mode', description: l === 'ru' ? 'Режим очистки' : 'Cleaning mode' },
      { command: 'clean', description: l === 'ru' ? 'Очистить файл (ответом на сообщение)' : 'Clean a file (as a reply)' },
      { command: 'meta', description: l === 'ru' ? 'Показать метаданные (ответом на сообщение)' : 'Show metadata (as a reply)' },
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
