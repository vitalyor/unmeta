// Unmeta Telegram bot, for groups only (private chats are ignored). Tag @unmeta_bot in a caption or a reply to clean a file; a button under files is opt-in (/on).
// Always the Maximum preset. Every file is a row in the database (db.ts): a restart loses nothing, a repeat runs
// nothing twice, and each file is cleaned in its own process (worker.ts), so a bad file only costs that file.
// Talks to a local Bot API server (files up to 2 GB, exchanged by path).
import { fork, type ChildProcess, spawn } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { mkdir, readdir, readFile, rename, rm, stat, statfs, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { esc, MAX_BYTES, mediaOf, offerable, sendCall, type Item, type Shape, albumItem, albumKind } from './chat';
import { openDb, ENDED, LIVE, WEEK, type Batch, type Job, type JobStatus } from './db';
import type { Done } from './worker';
import ruCopy from '../copy/ru.json';
import enCopy from '../copy/en.json';

const env = (k: string, d: number) => Number(process.env[k] ?? d);
const TOKEN = process.env.BOT_TOKEN ?? '';
const API = `${process.env.BOT_API ?? 'http://127.0.0.1:8081'}/bot${TOKEN}`;
const WORK = process.env.WORK_DIR ?? '/tmp/unmeta';
const DB_FILE = process.env.DB_FILE ?? join(WORK, 'unmeta.db');
const CACHE = process.env.CACHE_DIR ?? join(WORK, '..', TOKEN); // where the Bot API server keeps downloaded files
// One button under the last file: it waits for a pause in someone's files, and moves down if more arrive while nobody pressed
const QUIET = env('QUIET_MS', 1500), WINDOW = env('WINDOW_MS', 60_000), WINDOW_MAX = env('WINDOW_MAX_MS', 600_000);
const SCRUB = env('SCRUB_MS', 300_000);
const HOLD = 30_000 * env('SLEEP_SCALE', 1); // the longest a job waits for its status message: see release()
const POLL = env('POLL_S', 50), TICK = env('TICK_MS', 300), RETRY = env('RETRY_MS', 5000), EDIT_EVERY = env('EDIT_EVERY_MS', 3500);
const JOB_MIN = env('JOB_MIN_MS', 120_000), SLEEP_SCALE = env('SLEEP_SCALE', 1);
const MAX_ATTEMPTS = 3;
const STALL = env('STALL_MS', 150_000); // getUpdates answers within POLL seconds, whatever the queue is doing
const CANARY = env('CANARY_MS', 900_000);
const OWNER = env('OWNER_ID', 0); // alerts about what the bot can't fix itself; the one exception to silence in private chats
const FAILS_PER_HOUR = 3; // one bad file is life; this many means something is broken
const BYTES_PER_MS = 2 * 1024 ** 2 / 1000; // slowest honest speed for one file, before it counts as hung
const patience = (size: number) => Math.max(JOB_MIN, size / BYTES_PER_MS);
const safe = (s: string) => s.replace(/\/\S+/g, '<path>').slice(0, 300); // paths hold the bot's token

// ---------- texts ----------
const T = {
  ru: {
    start: '<h3>Убираю скрытые данные из файлов</h3><p>Геопозиция, модель телефона, даты, автор, история правок.</p><h4>Как очистить</h4><ul><li>Напишите @unmeta_bot в подписи к файлу или альбому.</li><li>Или напишите так в ответ на сообщение с файлом.</li></ul><p>Фото, видео, аудио, PDF, документы; со сжатием или без, проверю всё. Отправляйте как <b>файл</b>, а не как фото: так Telegram не пережмёт его.</p><blockquote expandable><b>Кнопка под своими файлами в этой группе:</b> /on, выключить: /off.<br><b>Приватность:</b> файл скачивается на сервер бота только когда вы просите и удаляется сразу после ответа. Другие сообщения группы бот не читает. Неделю он хранит номера сообщений и статусы, а для альбомов ещё имена файлов и ссылки на них в Telegram: так очищается весь альбом. Самих файлов там нет. Если файл совсем не должен покидать устройство, есть сайт: https://unmeta.nolim.cloud</blockquote>',
    queued: '<b>В очереди</b>',
    queuedAhead: '<b>В очереди</b>\nФайлов впереди: {n}',
    stageGet: 'Получаю файл',
    stageClean: 'Убираю скрытые данные',
    stageSend: 'Отправляю чистый файл',
    step: 'Шаг {i} из 3: {stage}',
    packTitle: '<b>Чищу файлы: {done} из {n}</b>',
    now: 'Сейчас: {name}',
    etaSoon: 'Осталось меньше минуты',
    etaMin: 'Осталось примерно {n} мин',
    clean: '✅ <b>Файл очищен</b>',
    cleanMany: '✅ <b>Файлы очищены: {n}</b>',
    leftover: '⚠️ <b>Файл очищен не полностью, осталось: {list}</b>',
    nothing: '✨ <b>Файл чистый</b>',
    unsupported: '🚫 <b>Файл не очищен: формат не поддерживается</b>',
    tooBigDoc: '📦 <b>Файл не очищен: слишком большой</b>',
    failed: '❌ <b>Файл не очищен</b>',
    corrupt: '💔 <b>Файл не очищен: он повреждён</b>',
    replyToFile: 'Напишите @unmeta_bot в ответ на сообщение с файлом.',
    offer: 'В файле <b>{name}</b> могут быть скрытые данные.',
    offerMany: '<b>Файлов: {n}</b>\nВ них могут быть скрытые данные.',
    btnClean: 'Очистить от метаданных',
    btnCleanMany: 'Очистить все: {n}',
    gone: 'Кнопка устарела. Напишите @unmeta_bot в ответ на сообщение с файлом.',
    already: 'Этот файл уже очищен.',
    working: 'Этот файл уже в работе.',
    off: 'Кнопка под вашими файлами в этой группе выключена. Чистить файлы можно как раньше: @unmeta_bot в подписи или ответе. Включить: /on',
    on: 'Теперь под вашими файлами в этой группе будет кнопка очистки. Выключить: /off',
    summary: '🧹 <b>Очищено: {done} из {n}</b>',
  },
  en: {
    start: '<h3>I remove hidden data from files</h3><p>Location, phone model, dates, author, edit history.</p><h4>How to clean</h4><ul><li>Write @unmeta_bot in the caption of a file or album.</li><li>Or write it in a reply to a message with a file.</li></ul><p>Photos, video, audio, PDFs, documents; compressed or not, I check them all. Send it as a <b>file</b>, not as a photo, so Telegram does not recompress it.</p><blockquote expandable><b>A button under your files in this group:</b> /on, turn it off: /off.<br><b>Privacy:</b> a file reaches the bot\'s server only when you ask, and is deleted right after the reply. The bot does not read other group messages. It keeps message numbers and statuses for a week, plus file names and Telegram links for albums, so a whole album can be cleaned. No files. If the file must never leave your device, use the site: https://unmeta.nolim.cloud</blockquote>',
    queued: '<b>Queued</b>',
    queuedAhead: '<b>Queued</b>\nFiles ahead: {n}',
    stageGet: 'Getting the file',
    stageClean: 'Removing hidden data',
    stageSend: 'Sending the clean file',
    step: 'Step {i} of 3: {stage}',
    packTitle: '<b>Cleaning files: {done} of {n}</b>',
    now: 'Now: {name}',
    etaSoon: 'Less than a minute left',
    etaMin: 'About {n} min left',
    clean: '✅ <b>The file is clean</b>',
    cleanMany: '✅ <b>Files are clean: {n}</b>',
    leftover: '⚠️ <b>Not everything could be removed: {list}</b>',
    nothing: '✨ <b>The file is clean</b>',
    unsupported: '🚫 <b>Not cleaned: format not supported</b>',
    tooBigDoc: '📦 <b>Not cleaned: file too big</b>',
    failed: "❌ <b>Not cleaned</b>",
    corrupt: "💔 <b>Not cleaned: the file is damaged</b>",
    replyToFile: 'Write @unmeta_bot in a reply to a message with a file.',
    offer: '<b>{name}</b> may contain hidden data.',
    offerMany: '<b>Files: {n}</b>\nThey may contain hidden data.',
    btnClean: 'Remove metadata',
    btnCleanMany: 'Clean all: {n}',
    gone: 'This button is out of date. Write @unmeta_bot in a reply to a message with a file.',
    already: 'This file is already clean.',
    working: 'This file is already being cleaned.',
    off: 'The button under your files in this group is off. You can still clean files: @unmeta_bot in a caption or reply. Turn it on: /on',
    on: 'A clean button will now appear under your files in this group. Turn it off: /off',
    summary: '🧹 <b>Cleaned: {done} of {n}</b>',
  },
};
type Lang = keyof typeof T;
const COPY = { ru: ruCopy, en: enCopy };
// ponytail: always Russian, the bot lives only in approved Russian groups; the English texts stay for the day this line goes back to reading language_code
const langOf = (_u?: { language_code?: string }): Lang => 'ru';
const texts = (l: string) => T[l === 'ru' ? 'ru' : 'en'];
const fmt = (s: string, v: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
const catName = (l: string, c: string) => (COPY[l === 'ru' ? 'ru' : 'en'].categories as Record<string, { name: string }>)[c]?.name ?? c;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------- Bot API ----------
// node:http, not fetch: fetch gives up on a response after 5 minutes, and a 2 GB file takes longer. It would then be sent twice.
class ApiError extends Error {
  constructor(readonly code: number, readonly description: string, readonly parameters: any) { super(`${code}: ${description}`); }
}
function post(method: string, params: object, timeout: number): Promise<any> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(params);
    const r = httpRequest(`${API}/${method}`, { method: 'POST', headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } }, (res) => {
      let t = '';
      res.setEncoding('utf8').on('data', (d) => { t += d; }).on('error', reject).on('end', () => {
        try { const j = JSON.parse(t); if (j.ok) resolve(j.result); else reject(new ApiError(j.error_code, j.description, j.parameters)); }
        catch { reject(new Error(`${method}: bad response`)); }
      });
    });
    r.setTimeout(timeout, () => r.destroy(new Error(`${method}: timed out`)));
    r.on('error', reject).end(body);
  });
}
const SENDS = new Set(['sendMediaGroup', 'sendDocument', 'sendVideo', 'sendAudio', 'sendAnimation', 'sendVoice', 'sendVideoNote']);
/** Waits out Telegram's rate limit and network hiccups. Never repeats a send whose fate is unknown: the job's retry decides. */
async function tg<R = any>(method: string, params: object = {}, timeout = method === 'getUpdates' ? 70_000 : 30_000): Promise<R> {
  for (let i = 0; ; i++) {
    try { return await post(method, params, timeout); }
    catch (e) {
      if (e instanceof ApiError && e.code === 429 && i < 10) { await sleep((e.parameters?.retry_after ?? 5) * 1000 * SLEEP_SCALE); continue; }
      if (!(e instanceof ApiError) && !SENDS.has(method) && !/timed out/.test(String(e)) && i < 3) { await sleep(1000 * (i + 1) * SLEEP_SCALE); continue; }
      throw e;
    }
  }
}
/** Status text is decoration: never wait for it, never fail because of it. */
const soft = (method: string, params: object) => post(method, params, 30_000).catch(() => {});
const alerted = new Map<string, number>();
/** To the owner's private chat, only for what doesn't heal by itself, and at most every 6 hours per kind. Error codes only: never a file name. */
function alert(kind: string, text: string) {
  if (!OWNER || Date.now() - (alerted.get(kind) ?? -Infinity) < 6 * 3600_000) return;
  alerted.set(kind, Date.now());
  void soft('sendMessage', { chat_id: OWNER, text: `Unmeta: ${text}` });
}
const edit = (chat: number, id: number, text: string, keyboard?: object) =>
  soft('editMessageText', { chat_id: chat, message_id: id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...(keyboard ? { reply_markup: keyboard } : {}) });
const place = (thread: number | null, reply?: number | null) => ({
  ...(thread ? { message_thread_id: thread } : {}),
  ...(reply ? { reply_parameters: { message_id: reply, allow_sending_without_reply: true } } : {}),
});
/** A group that became a supergroup gets a new id; Telegram says so in the error. */
async function inChat<R>(chat: number, fn: (chat: number) => Promise<R>): Promise<R> {
  try { return await fn(chat); }
  catch (e) {
    const to = e instanceof ApiError ? e.parameters?.migrate_to_chat_id : undefined;
    if (!to) throw e;
    migrate(chat, to);
    return fn(to);
  }
}
const say = (chat: number, thread: number | null, text: string, reply?: number | null, extra: object = {}) =>
  inChat(chat, (c) => tg<{ message_id: number }>('sendMessage', { chat_id: c, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...place(thread, reply), ...extra }));

// ---------- database ----------
await mkdir(WORK, { recursive: true });
const { db, reset: dbReset } = openDb(DB_FILE);
const tx = <R>(fn: () => R): R => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
const q = (sql: string) => db.prepare(sql);
const jobIn = (chat: number, message: number) => q('SELECT * FROM jobs WHERE chat_id = ? AND message_id = ?').get(chat, message) as Job | undefined;
const batchById = (id: number) => q('SELECT * FROM batches WHERE id = ?').get(id) as Batch | undefined;
const wantsButton = (chat: number, user: number) => !!q('SELECT 1 FROM buttons WHERE chat_id = ? AND user_id = ?').get(chat, user);
function setJob(id: number, status: JobStatus, fields: { error?: string | null; result_id?: number | null; next_at?: number } = {}) {
  const ended = status === 'done' || status === 'nothing' || status === 'skipped' || status === 'failed';
  q(`UPDATE jobs SET status = ?, error = COALESCE(?, error), result_id = COALESCE(?, result_id), next_at = ?, updated_at = ?
     ${ended ? ', file_id = NULL, file_name = NULL, shape = NULL' : ''} WHERE id = ?`)
    .run(status, fields.error ?? null, fields.result_id ?? null, fields.next_at ?? 0, Date.now(), id);
  if (status === 'failed' && !/^(bot-removed|offer-failed)/.test(fields.error ?? '')) {
    const { n } = q(`SELECT COUNT(*) AS n FROM jobs WHERE status = 'failed' AND updated_at > ? AND error NOT LIKE 'bot-removed%' AND error NOT LIKE 'offer-failed%'`).get(Date.now() - 3600_000) as { n: number };
    if (n >= FAILS_PER_HOUR) alert('failing', `за час не очищено файлов: ${n}. Последняя ошибка: ${fields.error}`);
  }
}
function migrate(from: number, to: number) {
  tx(() => {
    q('INSERT OR REPLACE INTO state VALUES (?, ?)').run(`moved:${from}`, String(to)); // updates sent just before the move still carry the old id
    q('UPDATE OR IGNORE jobs SET chat_id = ? WHERE chat_id = ?').run(to, from);
    q('UPDATE batches SET chat_id = ? WHERE chat_id = ?').run(to, from);
    q('UPDATE OR IGNORE buttons SET chat_id = ? WHERE chat_id = ?').run(to, from);
    q('UPDATE OR IGNORE allowed SET chat_id = ? WHERE chat_id = ?').run(to, from);
  });
}
function newBatch(chat: number, thread: number | null, user: number, lang: string, replyTo: number, status: Batch['status']) {
  const now = Date.now();
  return Number(q('INSERT INTO batches (chat_id, thread_id, user_id, lang, reply_to, status, last_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(chat, thread, user, lang, replyTo, status, now, now, now).lastInsertRowid);
}
function addJob(chat: number, thread: number | null, message: number, user: number, lang: string, item: Item, batch: number, status: JobStatus, album: string | null = null) {
  const now = Date.now();
  q('INSERT INTO jobs (chat_id, thread_id, message_id, user_id, lang, file_id, file_name, file_size, photo, shape, batch_id, status, album, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(chat, thread, message, user, lang, item.media.file_id, item.name, item.media.file_size ?? 0, item.photo ? 1 : 0, JSON.stringify(item.shape), batch, status, album, now, now);
}

// ---------- offering the button ----------
const threadOf = (m: any): number | null => (m.is_topic_message ? m.message_thread_id : null);
const senderOf = (m: any): number => (m.from?.is_bot && m.sender_chat ? m.sender_chat.id : m.from?.id ?? m.sender_chat?.id ?? m.chat.id);

function offer(m: any, user: number, lang: string) {
  const chat = m.chat.id, thread = threadOf(m), now = Date.now();
  if (jobIn(chat, m.message_id)) return; // Telegram repeated an update
  tx(() => {
    const open = q(`SELECT * FROM batches WHERE chat_id = ? AND thread_id IS ? AND user_id = ? AND status IN ('open', 'offered') AND last_at > ? AND created_at > ? ORDER BY id DESC`)
      .get(chat, thread, user, now - WINDOW, now - WINDOW_MAX) as Batch | undefined;
    const batch = open?.id ?? newBatch(chat, thread, user, lang, m.message_id, 'open');
    addJob(chat, thread, m.message_id, user, lang, mediaOf(m)!, batch, 'offered', m.media_group_id ?? null);
    q('UPDATE batches SET last_at = ?, reply_to = ? WHERE id = ?').run(now, m.message_id, batch);
  });
}

/**
 * Telegram sends an album as separate messages and can't list them later, so /clean on one file needs the others on record.
 * Nothing is downloaded or said; the name and file_id stay until the file is cleaned, or a week. If /clean already took
 * this album (it came in the caption of the first file), this file joins that work.
 */
function remember(m: any, user: number, lang: string, button: boolean) {
  const chat = m.chat.id, thread = threadOf(m), album = m.media_group_id as string;
  if (jobIn(chat, m.message_id)) return;
  const taken = q(`SELECT j.batch_id AS id, b.status FROM jobs j JOIN batches b ON b.id = j.batch_id WHERE j.chat_id = ? AND j.album = ? AND j.status NOT IN ('seen', 'offered') ORDER BY j.id DESC`).get(chat, album) as { id: number; status: string } | undefined;
  if (taken) return void tx(() => addJob(chat, thread, m.message_id, user, lang, mediaOf(m)!, taken.status === 'finished' ? newBatch(chat, thread, user, lang, m.message_id, 'queued') : taken.id, 'queued', album));
  if (button) return offer(m, user, lang);
  tx(() => {
    const mate = q(`SELECT batch_id FROM jobs WHERE chat_id = ? AND album = ? AND status = 'seen'`).get(chat, album) as { batch_id: number } | undefined;
    addJob(chat, thread, m.message_id, user, lang, mediaOf(m)!, mate?.batch_id ?? newBatch(chat, thread, user, lang, m.message_id, 'finished'), 'seen', album);
  });
}

const offerText = (b: Batch, jobs: Job[]) => {
  const t = texts(b.lang), n = jobs.length;
  return {
    text: n === 1 ? fmt(t.offer, { name: esc(jobs[0].file_name ?? '') }) : fmt(t.offerMany, { n }),
    reply_markup: { inline_keyboard: [[{ text: n === 1 ? t.btnClean : fmt(t.btnCleanMany, { n }), callback_data: `b:${b.id}` }]] },
  };
};

async function showOffers() {
  const quiet = Date.now() - QUIET;
  for (const b of q(`SELECT * FROM batches WHERE status IN ('open', 'offered') AND last_at < ?`).all(quiet) as unknown as Batch[]) {
    const jobs = q(`SELECT * FROM jobs WHERE batch_id = ? AND status = 'offered'`).all(b.id) as unknown as Job[];
    if (b.status === 'offered' && jobs.length === b.shown) continue;
    if (!jobs.length) { if (b.status === 'open') q('DELETE FROM batches WHERE id = ?').run(b.id); continue; }
    try {
      const { text, reply_markup } = offerText(b, jobs);
      const m = await say(b.chat_id, b.thread_id, text, b.reply_to, { reply_markup });
      q(`UPDATE batches SET status = 'offered', prompt_id = ?, shown = ?, updated_at = ? WHERE id = ?`).run(m.message_id, jobs.length, Date.now(), b.id);
      if (b.prompt_id) await soft('deleteMessage', { chat_id: b.chat_id, message_id: b.prompt_id }); // the old button, now above the new files
    } catch (e) {
      if (!(e instanceof ApiError) || e.code === 429 || e.code >= 500) continue; // Telegram or the network: the next tick tries again
      console.error('offer failed:', e instanceof Error ? e.message : e);
      const error = `offer-failed: ${e instanceof Error ? e.message : e}`.slice(0, 120);
      tx(() => { for (const j of jobs) setJob(j.id, 'failed', { error }); q(`UPDATE batches SET status = 'finished', updated_at = ? WHERE id = ?`).run(Date.now(), b.id); });
    }
  }
}

const queuedText = (lang: string, batch: number) => {
  const ahead = (q(`SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running', 'sending') AND batch_id != ?`).get(batch) as { n: number }).n;
  return ahead ? fmt(texts(lang).queuedAhead, { n: ahead }) : texts(lang).queued;
};

// ---------- /clean ----------
/** Jobs wait for their status message, or the first step is shown nowhere and a big file sits on "queued" while it downloads. HOLD covers a crash in between. */
const release = (batch: number) => { q(`UPDATE jobs SET next_at = 0 WHERE batch_id = ? AND status = 'queued'`).run(batch); wake(); };
let wake = () => {}; // an idle queue starts at once, not on its next tick

async function cleanRequest(m: any, target: any, user: number, lang: string) {
  const chat = m.chat.id, t = texts(lang), item = mediaOf(target), thread = threadOf(m) ?? threadOf(target);
  if (!item) return void await say(chat, thread, t.replyToFile, m.message_id);
  const seen = jobIn(chat, target.message_id);
  const rest = target.media_group_id ? q(`SELECT * FROM jobs WHERE chat_id = ? AND album = ? AND message_id != ? AND status IN ('seen', 'offered') ORDER BY id`)
    .all(chat, target.media_group_id, target.message_id) as unknown as Job[] : [];
  const settled = seen?.status === 'done' || seen?.status === 'nothing' || ['queued', 'running', 'sending'].includes(seen?.status ?? '');
  if (settled && !rest.length) {
    if (seen!.status === 'done') return void await say(chat, thread, t.already, seen!.result_id ?? target.message_id);
    if (seen!.status === 'nothing') return void await say(chat, thread, t.nothing, target.message_id);
    return void await say(chat, thread, t.working, target.message_id);
  }
  const batch = tx(() => {
    const id = newBatch(chat, thread, user, lang, target.message_id, 'queued');
    if (seen && !settled) q(`UPDATE jobs SET batch_id = ?, status = 'queued', file_id = ?, file_name = ?, file_size = ?, shape = ?, attempts = 0, next_at = 0, error = NULL, updated_at = ? WHERE id = ?`)
      .run(id, item.media.file_id, item.name, item.media.file_size ?? 0, JSON.stringify(item.shape), Date.now(), seen.id);
    else if (!seen) addJob(chat, thread, target.message_id, user, lang, item, id, 'queued', target.media_group_id ?? null);
    for (const j of rest) q(`UPDATE jobs SET batch_id = ?, status = 'queued', lang = ?, updated_at = ? WHERE id = ?`).run(id, lang, Date.now(), j.id);
    q(`UPDATE jobs SET next_at = ? WHERE batch_id = ?`).run(Date.now() + HOLD, id);
    return id;
  });
  for (const old of new Set([...(seen && !settled ? [seen.batch_id] : []), ...rest.map((j) => j.batch_id)])) await settle(old); // an old pack may be empty now
  const s = await say(chat, thread, queuedText(lang, batch), target.message_id).catch(() => null);
  if (s) q('UPDATE batches SET prompt_id = ? WHERE id = ?').run(s.message_id, batch);
  release(batch);
}

// ---------- the queue: one file at a time, taking turns between people ----------
// ponytail: one worker on this 1-core server; a second loop is enough if the server grows
const served = new Map<number, number>();
function nextJob(): Job | undefined {
  const heads = q(`SELECT user_id, MIN(id) AS id FROM jobs WHERE status = 'queued' AND next_at <= ? GROUP BY user_id`).all(Date.now()) as unknown as { user_id: number; id: number }[];
  if (!heads.length) return undefined;
  heads.sort((a, b) => (served.get(a.user_id) ?? 0) - (served.get(b.user_id) ?? 0) || a.id - b.id);
  served.set(heads[0].user_id, Date.now());
  return q('SELECT * FROM jobs WHERE id = ?').get(heads[0].id) as unknown as Job;
}

// One warm worker, taking files in turn. Replaced after a crash, a hang, a big file or 30 files, so nothing builds up.
const WORKER_JOBS = 30, WORKER_HEAVY = 50 * 1024 ** 2;
let worker: ChildProcess | null = null, workerJobs = 0;
function warmWorker() {
  if (worker) return worker;
  const c = fork(join(import.meta.dirname, 'worker.mjs'), { detached: true, execArgv: ['--max-old-space-size=450'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  c.on('exit', () => { if (worker === c) worker = null; setTimeout(warmWorker, 2000 * SLEEP_SCALE).unref(); }); // the next file shouldn't pay 7 s for a cold start
  c.on('error', () => {}); // a send to a dead worker: its exit answers the job
  workerJobs = 0;
  return (worker = c);
}
const killGroup = (c: ChildProcess) => { try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* already gone */ } }; // the group: ffmpeg too

function isolate(path: string, name: string, size: number, onProgress: (p: number) => void): Promise<Done> {
  return new Promise((resolve) => {
    const c = warmWorker();
    const hung = setTimeout(() => killGroup(c), patience(size));
    const end = (d: Done) => { clearTimeout(hung); c.off('message', answered); c.off('exit', died); resolve(d); };
    const answered = (m: unknown) => {
      if (typeof (m as { progress?: number }).progress === 'number') return onProgress((m as { progress: number }).progress);
      end(m as Done);
      if (++workerJobs >= WORKER_JOBS || size > WORKER_HEAVY) { worker = null; killGroup(c); }
    };
    const died = (code: number | null, signal: string | null) => end({ outcome: 'error', error: `worker-died:${signal ?? code}` });
    c.on('message', answered);
    c.once('exit', died);
    c.send({ path, name });
  });
}

/**
 * Files live only while their job runs, and the queue runs one job. So between jobs nothing may exist: no list of what to
 * delete, nothing to miss. Covers a getFile whose answer was lost, and one that finishes after the bot gave up on it.
 * Left alone: Telegram's own database, the files directly in CACHE. Never call this during a job.
 */
async function scrub() {
  const wipe = (p: string) => rm(p, { recursive: true, force: true }).catch((e) => console.error('scrub:', e.code)); // the path holds the token
  for (const n of await readdir(WORK).catch(() => [] as string[])) if (n.startsWith('job-')) await wipe(join(WORK, n));
  for (const d of await readdir(CACHE, { withFileTypes: true }).catch(() => [])) {
    if (d.isDirectory()) for (const n of await readdir(join(CACHE, d.name)).catch(() => [] as string[])) await wipe(join(CACHE, d.name, n));
  }
}

/** Free disk for `need` bytes plus a margin. Measured: a file takes 2x its size (original + clean copy; ffmpeg moves the MP4 index in place). */
async function hasRoom(need: number) {
  const s = await statfs(WORK);
  return s.bavail * s.bsize > need + 300 * 1024 ** 2;
}

function retryLater(job: Job, error: string) {
  if (job.attempts >= MAX_ATTEMPTS) setJob(job.id, 'failed', { error });
  else setJob(job.id, 'queued', { error, next_at: Date.now() + RETRY * job.attempts });
}

function botRemoved(chat: number) {
  tx(() => {
    for (const j of q(`SELECT id FROM jobs WHERE chat_id = ? AND status NOT IN ${ENDED}`).all(chat) as unknown as { id: number }[]) setJob(j.id, 'failed', { error: 'bot-removed' });
    q(`UPDATE batches SET status = 'finished', updated_at = ? WHERE chat_id = ? AND status != 'finished'`).run(Date.now(), chat);
  });
}

/** Bytes the Bot API server has moved over the network, from net-meter in compose.yaml. Null without it: then only the step shows. */
async function traffic() {
  const m = (await readFile(join(WORK, 'net'), 'utf8').catch(() => '')).match(/eth0:\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
  return m ? { rx: Number(m[1]), tx: Number(m[2]) } : null;
}

const OVERHEAD = { rx: 1.01, tx: 1.12 }; // measured on a 571 MB video: bytes on the wire per byte of file; retune if the bar stops short or jumps at the end

/** Telegram reports no progress on files, but one file at a time means the traffic is this file, plus a little protocol overhead. */
async function metered<R>(way: 'rx' | 'tx', size: number, report: (p: number) => unknown, work: () => Promise<R>): Promise<R> {
  const from = await traffic();
  const watch = setInterval(() => void traffic().then((now) => {
    const moved = from && now ? now[way] - from[way] : 0;
    if (moved > 0 && size) report(Math.min(0.99, moved / (size * OVERHEAD[way])));
  }).catch(() => {}), 1000);
  try { return await work(); } finally { clearInterval(watch); }
}

type Ready = { job: Job; out: string; thumb: string | null; left: string[] };
let album = { i: 0, n: 1 }; // the progress of files cleaned together and sent at the end

/** Why a job stopped, and what happens to it next. */
function gaveUp(job: Job, e: unknown) {
  const msg = safe(e instanceof Error ? e.message : String(e));
  console.error(`job ${job.id} failed: ${msg}`); // ids only: no file names or contents in logs
  if (e instanceof ApiError && e.code === 403) return botRemoved(job.chat_id);
  if (e instanceof ApiError && e.code === 429) { // not the file's fault: no attempt spent
    q('UPDATE jobs SET attempts = attempts - 1 WHERE id = ?').run(job.id);
    return setJob(job.id, 'queued', { next_at: Date.now() + 1000 * SLEEP_SCALE * (e.parameters?.retry_after ?? 5) });
  }
  if (e instanceof ApiError && e.code === 400) return setJob(job.id, 'failed', { error: msg }); // a wrong request stays wrong
  retryLater(job, msg);
}

/** Download and clean. A file that ends here (nothing found, damaged, a retry) returns nothing and stays out of what is sent. */
async function prepare(job: Job): Promise<Ready | undefined> {
  if (!q(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ? AND status = 'queued'`).run(Date.now(), job.id).changes) return; // the bot left that group a moment ago
  job.attempts++;
  if (job.file_size > MAX_BYTES) return void setJob(job.id, 'skipped', { error: 'too-big' }); // never download what the disk can't hold
  await progress(job, 'get', null, true);
  if (!(await hasRoom(2 * job.file_size))) return void retryLater(job, 'no-disk-space');
  const input = (await metered('rx', job.file_size, (p) => progress(job, 'get', p), () => tg<{ file_path: string }>('getFile', { file_id: job.file_id }, patience(job.file_size)))).file_path;
  await progress(job, 'clean', null, true);
  const d = await isolate(input, job.file_name ?? 'file', job.file_size, (p) => void progress(job, 'clean', p));
  await rm(input, { force: true }); // an album can be ten big files
  if (d.outcome === 'nothing') return void setJob(job.id, 'nothing');
  if (d.outcome === 'text' || d.outcome === 'unsupported' || d.outcome === 'too-big' || d.outcome === 'empty') return void setJob(job.id, 'skipped', { error: d.outcome });
  if (d.outcome === 'error') {
    if (/^unsupported/.test(d.error)) return void setJob(job.id, 'skipped', { error: 'unsupported' });
    if (/no-av-streams|Error opening|invalid|corrupt|not a valid|truncated|moov atom|ffmpeg exit|unexpected|No PDF header|Failed to parse/i.test(d.error)) {
      console.error(`job ${job.id} unreadable: ${safe(d.error)}`);
      return void setJob(job.id, 'skipped', { error: 'corrupt' });
    }
    if (d.error.startsWith('verify-failed')) return void setJob(job.id, 'failed', { error: safe(d.error) }); // never hand out a file that failed the check
    return void retryLater(job, safe(d.error));
  }
  const out = join(d.out, '..', d.name);
  await rename(d.out, out);
  return { job, out, thumb: d.thumb, left: d.left };
}

/** Send one file the way it came, or several as one album answering the first of them. */
async function deliver(group: Ready[]) {
  const first = group[0].job, t = texts(first.lang), { thread_id: thread, message_id: reply } = first;
  for (const r of group) setJob(r.job.id, 'sending');
  await progress(first, 'send', null, true);
  const names = (l: string[]) => l.map((c) => catName(first.lang, c)).join(', ');
  const left = [...new Set(group.flatMap((r) => r.left))];
  const caption = left.length ? fmt(t.leftover, { list: names(left) }) : group.length > 1 ? fmt(t.cleanMany, { n: group.length }) : t.clean; // one line: the result, nothing else
  const chat = (q('SELECT chat_id FROM jobs WHERE id = ?').get(first.id) as { chat_id: number }).chat_id; // a group can migrate mid-queue
  const shape = (j: Job) => JSON.parse(j.shape ?? '{"type":"document"}') as Shape;
  let size = 0;
  for (const r of group) size += (await stat(r.out)).size;
  const send = (method: string, params: object) => metered('tx', size, (p) => progress(first, 'send', p), () =>
    inChat(chat, (c) => tg<any>(method, { chat_id: c, ...params, ...place(thread, reply) }, patience(size))));
  if (group.length > 1) {
    const sent = await send('sendMediaGroup', { media: group.map((r, i) => albumItem(shape(r.job), r.out, r.thumb, i ? undefined : caption)) }) as { message_id: number }[];
    group.forEach((r, i) => setJob(r.job.id, 'done', { result_id: sent[i].message_id, error: null }));
  } else {
    const call = sendCall(shape(first), group[0].out, group[0].thumb, caption);
    const sent = await send(call.method, { ...call.params, parse_mode: 'HTML' }) as { message_id: number };
    setJob(first.id, 'done', { result_id: sent.message_id, error: null });
  }
}

const ALBUM_MAX = 10;
function albums(ready: Ready[]) {
  const groups: Ready[][] = [], open = new Map<string, Ready[]>();
  for (const r of ready) {
    const kind = r.job.album ? albumKind(JSON.parse(r.job.shape ?? '{"type":"document"}') as Shape) : null;
    if (!kind) { groups.push([r]); continue; }
    let g = open.get(kind);
    if (!g || g.length === ALBUM_MAX) { open.set(kind, g = []); groups.push(g); }
    g.push(r);
  }
  return groups;
}

/** One queue slot: a file, or a whole album, because it can only go out as an album once all of it is clean. */
async function process1(first: Job) {
  const mates = first.album ? q(`SELECT * FROM jobs WHERE batch_id = ? AND album = ? AND status = 'queued' AND next_at <= ? ORDER BY id`).all(first.batch_id, first.album, Date.now()) as unknown as Job[] : [first];
  const size = mates.reduce((s, j) => s + j.file_size, 0);
  const jobs = mates.length > 1 && await hasRoom(size + Math.max(...mates.map((j) => j.file_size))) ? mates : [first]; // clean copies wait to go out together, each original goes once cleaned; no room: one by one
  jobDeadline = Date.now() + jobs.reduce((s, j) => s + 4 * patience(j.file_size), 60_000);
  const ready: Ready[] = [];
  album = { i: 0, n: jobs.length };
  try {
    for (const job of jobs) {
      const r = await prepare(job).catch((e) => void gaveUp(job, e));
      if (r) ready.push(r);
      album.i++;
    }
    for (const group of albums(ready)) await deliver(group).catch((e) => { for (const r of group) gaveUp(r.job, e); });
  } finally {
    album = { i: 0, n: 1 };
    await scrub();
    for (const id of new Set(jobs.map((j) => j.batch_id))) await settle(id);
  }
}

const bar = (p: number) => { const n = Math.round(Math.min(1, p) * 12); return '▰'.repeat(n) + '▱'.repeat(12 - n); };
const mb = (n: number) => (n >= 1024 ** 3 ? `${(n / 1024 ** 3).toFixed(1)} GB` : n >= 1024 ** 2 ? `${Math.round(n / 1024 ** 2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const shortName = (s: string | null) => esc([...(s ?? '')].length > 44 ? `${[...(s ?? '')].slice(0, 42).join('')}…` : s ?? '');
type Stage = 'get' | 'clean' | 'send';
const started = new Map<number, number>();

/** Progress in place of the button. Only video cleaning has real percentages: the rest shows the step, not invented numbers. */
async function progress(job: Job, stage: Stage, p: number | null, force = false) {
  const b = batchById(job.batch_id);
  if (!b?.prompt_id) return;
  const now = Date.now();
  const t = texts(b.lang), c = q(`SELECT COUNT(*) AS n, COALESCE(SUM(status IN ${ENDED}), 0) AS ended FROM jobs WHERE batch_id = ?`).get(b.id) as { n: number; ended: number };
  if ((!force || c.n > 1) && now - b.last_edit < EDIT_EVERY) return; // edits share the group's message limit with the files themselves
  q('UPDATE batches SET last_edit = ? WHERE id = ?').run(now, b.id);
  const part = stage === 'get' ? 0.4 * (p ?? 0) : stage === 'clean' ? 0.4 + 0.2 * (p ?? 0) : 0.6 + 0.4 * (p ?? 0); // by the time each step takes
  let text: string;
  if (c.n > 1) {
    if (!started.has(b.id)) started.set(b.id, now);
    const left = c.ended ? (now - started.get(b.id)!) / c.ended * (c.n - c.ended) / 60_000 : null;
    const done = (c.ended + (stage === 'send' ? album.n * part : 0.6 * album.i + part)) / c.n; // an album sends once, at the end: 60% is cleaning, the rest sending
    text = [fmt(t.packTitle, { done: c.ended + album.i, n: c.n }), `${bar(done)} ${Math.round(done * 100)}%`, fmt(t.now, { name: shortName(job.file_name) }),
      left === null ? '' : left < 1 ? t.etaSoon : fmt(t.etaMin, { n: Math.ceil(left) })].filter(Boolean).join('\n');
  } else {
    const label = stage === 'get' ? t.stageGet : stage === 'clean' ? t.stageClean : t.stageSend;
    const step = fmt(t.step, { i: stage === 'get' ? 1 : stage === 'clean' ? 2 : 3, stage: label });
    text = [`<b>${shortName(job.file_name)}</b>${job.file_size ? ` · ${mb(job.file_size)}` : ''}`, p === null ? step : `${bar(part)} ${Math.round(part * 100)}%`, ...(p === null ? [] : [step])].join('\n');
  }
  await edit(b.chat_id, b.prompt_id, text);
}

const reasonText = (t: (typeof T)['ru'], error: string | null) =>
  error === 'text' ? t.nothing : error === 'too-big' ? t.tooBigDoc : error === 'corrupt' || error === 'empty' ? t.corrupt : t.unsupported;

/** When a batch's last file ends: one short result in place of the button, not a message per file. */
async function settle(id: number) {
  const b = batchById(id);
  if (!b || b.status === 'finished') return;
  const jobs = q('SELECT * FROM jobs WHERE batch_id = ?').all(id) as unknown as Job[];
  if (jobs.some((j) => !ENDED.includes(`'${j.status}'`))) return;
  started.delete(id);
  if (!jobs.length) {
    q(`UPDATE batches SET status = 'finished', updated_at = ? WHERE id = ?`).run(Date.now(), id);
    if (b.prompt_id) await soft('deleteMessage', { chat_id: b.chat_id, message_id: b.prompt_id });
    return;
  }
  q(`UPDATE batches SET status = 'finished', updated_at = ? WHERE id = ?`).run(Date.now(), id);
  const t = texts(b.lang), count = (s: JobStatus) => jobs.filter((j) => j.status === s).length;
  let text: string | null;
  if (jobs.length === 1) {
    const j = jobs[0];
    text = j.status === 'done' ? null : j.status === 'nothing' ? t.nothing : j.status === 'failed' ? t.failed : reasonText(t, j.error);
  } else {
    text = count('done') === jobs.length ? null : fmt(t.summary, { done: count('done'), n: jobs.length });
  }
  if (jobs.some((j) => j.error === 'bot-removed')) return;
  if (b.prompt_id) { if (text) await inChat(b.chat_id, (c) => tg('editMessageText', { chat_id: c, message_id: b.prompt_id, text, parse_mode: 'HTML' })).catch(() => {}); else await soft('deleteMessage', { chat_id: b.chat_id, message_id: b.prompt_id }); }
  else if (text) await say(b.chat_id, b.thread_id, text, b.reply_to).catch(() => {});
}

// ---------- updates ----------
let me = '';
/** The bot works only where its owner put it: the server, its queue and its traffic are theirs. With no owner set, it works everywhere. */
const allowed = (chat: number) => !OWNER || !!q('SELECT 1 FROM allowed WHERE chat_id = ?').get(chat);
const leave = async (chat: number) => { botRemoved(chat); await soft('leaveChat', { chat_id: chat }); };
const INSIDE = ['member', 'administrator', 'restricted'];
async function onMembership(u: any) {
  if (u.chat.type !== 'group' && u.chat.type !== 'supergroup') return;
  const chat = u.chat.id;
  if (!INSIDE.includes(u.new_chat_member.status)) return void q('DELETE FROM allowed WHERE chat_id = ?').run(chat);
  if (INSIDE.includes(u.old_chat_member.status)) return; // only its rights changed
  if (u.from.id === OWNER) q('INSERT OR IGNORE INTO allowed VALUES (?)').run(chat);
  else if (!allowed(chat)) await leave(chat);
}
/** An ephemeral command gets an answer only its sender sees. Telegram may not deliver it, so nothing that matters goes this way. */
const just = (m: any) => (m.ephemeral_message_id ? { ephemeral_message_parameters: { receiver_user_id: m.from.id }, reply_parameters: { ephemeral_message_id: m.ephemeral_message_id } } : place(threadOf(m), m.message_id));
const answer = async (m: any, text: string) => { await tg('sendMessage', { chat_id: m.chat.id, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...just(m) }); };
const help = (m: any, lang: string) => tg('sendRichMessage', { chat_id: m.chat.id, rich_message: { html: texts(lang).start }, ...just(m) });
async function onMessage(m: any) {
  if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') return; // groups only
  if (m.migrate_to_chat_id) return migrate(m.chat.id, m.migrate_to_chat_id);
  const moved = q('SELECT value FROM state WHERE key = ?').get(`moved:${m.chat.id}`) as { value: string } | undefined;
  if (moved) m.chat.id = Number(moved.value);
  if (!allowed(m.chat.id)) return m.new_chat_members || m.group_chat_created ? undefined : leave(m.chat.id); // the join notice can beat the owner's membership event
  const chat = m.chat.id, lang = langOf(m.from), user = senderOf(m), t = T[lang];
  const said = String(m.text ?? m.caption ?? '');
  const hasFile = [m, m.reply_to_message, m.external_reply].some((x) => x && mediaOf(x));
  const tagged = hasFile && !(m.from?.is_bot && !m.sender_chat) && new RegExp(`(?<!\\w)@${me}(?!\\w)`, 'i').test(said); // no file: someone is just talking about the bot
  const cmd = said.match(/^\/(\w+)(@\w+)?/) ?? (tagged ? ['', 'clean'] : null);
  if (cmd?.[2] && cmd[2].slice(1).toLowerCase() !== me.toLowerCase()) return; // a command for another bot
  switch (cmd?.[1]) {
    case 'start': case 'help': return help(m, lang);
    case 'off': q('DELETE FROM buttons WHERE chat_id = ? AND user_id = ?').run(chat, user); return answer(m, t.off);
    case 'on': q('INSERT OR IGNORE INTO buttons VALUES (?, ?)').run(chat, user); return answer(m, t.on);
    case 'clean': {
      const target = mediaOf(m) ? m : m.reply_to_message && mediaOf(m.reply_to_message) ? m.reply_to_message
        : m.external_reply && mediaOf(m.external_reply) ? { ...m.external_reply, message_id: m.message_id } : m; // a reply to a file from another chat
      return cleanRequest(m, target, user, lang);
    }
  }
  if (!offerable(m)) return;
  if (m.media_group_id) remember(m, user, lang, wantsButton(chat, user));
  else if (wantsButton(chat, user)) offer(m, user, lang);
}

async function onCallback(q_: any) {
  const m = q_.message, lang = langOf(q_.from), [kind, value] = String(q_.data ?? '').split(':');
  if (m?.chat.type === 'private' || (m && !allowed(m.chat.id))) return void await soft('answerCallbackQuery', { callback_query_id: q_.id });
  if (kind === 'b') {
    const id = Number(value);
    const pressed = tx(() => {
      const n = q(`UPDATE batches SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'offered'`).run(Date.now(), id).changes;
      if (n) q(`UPDATE jobs SET status = 'queued', next_at = ?, updated_at = ? WHERE batch_id = ? AND status = 'offered'`).run(Date.now() + HOLD, Date.now(), id);
      return Boolean(n);
    });
    await soft('answerCallbackQuery', { callback_query_id: q_.id, ...(batchById(id) ? {} : { text: T[lang].gone }) });
    if (pressed && m) await edit(m.chat.id, m.message_id, queuedText(lang, id));
    if (pressed) release(id);
    if (pressed) await settle(id); // every file of the pack may have left through /clean
    return;
  }
  if (kind === 'file' && value === 'clean' && m?.reply_to_message) { // buttons sent before the database existed
    await soft('answerCallbackQuery', { callback_query_id: q_.id });
    await edit(m.chat.id, m.message_id, T[lang].queued);
    return cleanRequest({ ...m, message_id: m.message_id }, m.reply_to_message, q_.from.id, lang);
  }
  await soft('answerCallbackQuery', { callback_query_id: q_.id, ...(kind === 'file' ? { text: T[lang].gone } : {}) });
}

// ---------- three loops: Telegram's updates, the queue, the timers ----------
let polled = Date.now(), jobDeadline = Infinity;
async function updatesLoop() {
  for (let offset = 0; ;) {
    let updates: any[] = [];
    try {
      updates = await tg('getUpdates', { offset, timeout: POLL, allowed_updates: ['message', 'callback_query', 'my_chat_member'] });
      polled = Date.now();
      await writeFile(join(WORK, 'alive'), String(polled)).catch(() => {}); // Docker's health check looks at this file
    } catch (e) { console.error('getUpdates:', e instanceof Error ? e.message : e); await sleep(5000 * SLEEP_SCALE); continue; }
    for (const u of updates) {
      offset = u.update_id + 1;
      // Not awaited: decisions are made in order, right here, before the first network call. A chat under Telegram's rate limit waits alone.
      (u.message ? onMessage(u.message) : u.callback_query ? onCallback(u.callback_query) : u.my_chat_member ? onMembership(u.my_chat_member) : Promise.resolve())
        .catch((e) => console.error('update failed:', safe(e instanceof Error ? e.message : String(e))));
    }
  }
}

async function queueLoop() {
  let scrubbed = Date.now(), tested = Date.now() - CANARY + Math.min(CANARY, 30_000); // the first self-test soon after a start: a bad deploy shows at once
  for (;;) {
    jobDeadline = Infinity;
    const job = nextJob();
    if (job) { await process1(job).catch((e) => console.error('queue:', e instanceof Error ? e.message : e)); scrubbed = Date.now(); }
    else {
      if (Date.now() - scrubbed > SCRUB) { scrubbed = Date.now(); await scrub(); }
      if (CANARY && Date.now() - tested > CANARY) {
        jobDeadline = Date.now() + 4 * JOB_MIN;
        tested = (await selfTest()) ? Date.now() : Date.now() - CANARY + Math.min(CANARY, 60_000); // a miss is checked again in a minute
      }
      await new Promise<void>((r) => { wake = r; setTimeout(r, TICK); });
    }
  }
}

/** The bot can look alive and still be unable to clean. So now and then it cleans a tiny video of its own, start to finish. */
let misses = 0;
async function selfTest() {
  const dir = join(WORK, 'job-canary'), file = join(dir, 'canary.mp4');
  try {
    await mkdir(dir, { recursive: true });
    await new Promise<void>((ok, fail) => {
      const f = spawn('ffmpeg', ['-nostdin', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.1', '-c:v', 'mpeg4', '-metadata', 'artist=canary', file], { stdio: 'ignore' });
      f.on('error', fail).on('exit', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg ${code}`))));
    });
    const d = await isolate(file, 'canary.mp4', 0, () => {});
    if (d.outcome !== 'cleaned' || !d.removed.includes('author') || d.left.length) throw new Error(d.outcome === 'error' ? d.error : d.outcome);
    if (misses >= 2) { alerted.delete('self-test'); alert('self-test-ok', 'самопроверка снова проходит'); }
    misses = 0;
  } catch (e) {
    const why = safe(e instanceof Error ? e.message : String(e));
    console.error('self-test failed:', why);
    if (worker) killGroup(worker); // a fresh worker may be all it takes
    if (++misses >= 2) alert('self-test', `файлы не чистятся, самопроверка не проходит: ${why}`);
  } finally { await scrub(); }
  return misses === 0;
}

let purged = 0;
async function timersLoop() {
  for (;;) {
    try {
      await showOffers();
      if (Date.now() - purged > 3600_000) {
        purged = Date.now();
        await closeFinished();
        const old = Date.now() - WEEK;
        tx(() => {
          q(`DELETE FROM jobs WHERE updated_at < ? AND status NOT IN ${LIVE}`).run(old);
          q(`DELETE FROM batches WHERE updated_at < ? AND id NOT IN (SELECT batch_id FROM jobs)`).run(old);
        });
      }
    } catch (e) { console.error('timers:', e instanceof Error ? e.message : e); }
    await sleep(TICK);
  }
}

/** Stuck without having crashed: exit, and Docker starts a clean one. The queue is in the database, nothing is lost. */
function watchdog() {
  setInterval(() => {
    const stuck = Date.now() - polled > STALL ? 'no updates from Telegram' : Date.now() > jobDeadline ? 'job stuck' : null;
    if (stuck) { console.error(`watchdog: ${stuck}, restarting`); process.exit(1); }
  }, Math.min(STALL, 30_000) / 2).unref();
}

/** After a crash or restart: whatever was in progress goes back in line, its leftovers go away. */
async function recover() {
  await scrub();
  for (const j of q(`SELECT * FROM jobs WHERE status IN ('running', 'sending')`).all() as unknown as Job[]) {
    retryLater(j, 'interrupted');
  }
  await closeFinished();
}

/** A pack whose files have all ended but which never got its last word: the bot died in between. It would say "queued" forever. */
async function closeFinished() {
  for (const { id } of q(`SELECT id FROM batches WHERE status = 'queued' AND id NOT IN (SELECT batch_id FROM jobs WHERE status IN ${LIVE})`).all() as unknown as { id: number }[]) await settle(id);
}

async function main() {
  if (!TOKEN) throw new Error('BOT_TOKEN is not set');
  await recover();
  me = (await tg<{ username: string }>('getMe')).username;
  await tg('deleteMyCommands'); // the list once shown in private chats
  for (const code of ['ru', '']) {
    await tg('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
      { command: 'start', description: 'Как пользоваться', is_ephemeral: true },
      { command: 'off', description: 'Не показывать кнопку под моими файлами', is_ephemeral: true },
      { command: 'on', description: 'Показывать кнопку под моими файлами', is_ephemeral: true },
    ], ...(code ? { language_code: code } : {}) });
  }
  console.log(`@${me} ready`);
  warmWorker();
  polled = Date.now();
  if (dbReset) console.error('the database was damaged and started anew');
  watchdog();
  await Promise.all([updatesLoop(), queueLoop(), timersLoop()]);
}

void main().catch((e) => { console.error(e); process.exit(1); });
