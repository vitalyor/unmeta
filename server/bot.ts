// Unmeta Telegram bot, for groups only (private chats are ignored). A clean button under files, or /clean as a reply.
// Always the Maximum preset. Every file is a row in the database (db.ts): a restart loses nothing, a repeat runs
// nothing twice, and each file is cleaned in its own process (worker.ts), so a bad file only costs that file.
// Talks to a local Bot API server (files up to 2 GB, exchanged by path).
import { fork } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { readdir, rename, rm, statfs, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { esc, mediaOf, offerable, sendCall, type Item, type Shape } from './chat';
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
const CACHE_PARTS = ['documents', 'videos', 'photos', 'music', 'voice', 'animations', 'video_notes', 'thumbnails', 'temp'];
// Files from one person arriving together get one button, not a hundred
const WINDOW = env('WINDOW_MS', 2500), WINDOW_MAX = env('WINDOW_MAX_MS', 15000);
const TICK = env('TICK_MS', 300), RETRY = env('RETRY_MS', 5000), EDIT_EVERY = env('EDIT_EVERY_MS', 3000);
const JOB_MIN = env('JOB_MIN_MS', 120_000), SLEEP_SCALE = env('SLEEP_SCALE', 1);
const MAX_ATTEMPTS = 3;
const BYTES_PER_MS = 2 * 1024 ** 2 / 1000; // slowest honest speed for one file, before it counts as hung

// ---------- texts ----------
const T = {
  ru: {
    start: 'Отправьте в группу файл — фото, видео, аудио, PDF или документ — и я верну его без скрытых данных: геопозиции, модели телефона, дат, автора, истории правок.\n\nОтправляйте как <b>файл</b>, а не как фото: так Telegram не пережмёт его.\n\nПод файлом появится кнопка очистки: со сжатием или без, проверю всё. Ещё можно ответить на сообщение с файлом командой <code>/clean</code>.\n\nНе нужна кнопка под вашими файлами? /off, вернуть: /on.\n\nФайл скачивается на сервер бота только когда вы просите, и удаляется сразу после ответа. Другие сообщения группы бот не читает. Неделю он хранит только номера сообщений и статусы, без файлов. Если нужно, чтобы файл совсем не покидал устройство, — сайт: https://unmeta.nolim.cloud',
    queued: 'В очереди…',
    downloading: 'Получаю файл…',
    cleaning: 'Чищу…',
    progress: 'Чищу: готово {done} из {n}…',
    removed: 'Удалено: {list}',
    leftover: 'Не получилось убрать: {list}',
    nothing: 'Скрытых данных нет: проверил, файл чистый.',
    photoNote: 'Проверил это фото: скрытых данных нет. Telegram сжал его при отправке. Чтобы сохранить качество, отправляйте фото как файл.',
    text: 'В текстовых файлах негде прятать сведения о вас. Проверьте только сам текст.',
    unsupported: 'Этот формат я пока не умею чистить. С файлом всё в порядке, я его не трогал.',
    tooBig: 'Файл больше 2 ГБ: Telegram не даст мне его скачать.',
    tooBigDoc: 'Такой большой документ или фото я пока не потяну. Попробуйте сайт: https://unmeta.nolim.cloud',
    failed: 'Не получилось очистить этот файл. Не отправляйте его как чистый.',
    corrupt: 'Не получилось открыть файл: возможно, он повреждён.',
    replyToFile: 'Ответьте /clean на сообщение с файлом.',
    offer: 'В файле <b>{name}</b> могут быть скрытые данные.',
    offerMany: 'Файлов: {n}. В них могут быть скрытые данные.',
    btnClean: 'Очистить от метаданных',
    btnCleanMany: 'Очистить все: {n}',
    gone: 'Кнопка устарела. Ответьте /clean на сообщение с файлом.',
    already: 'Этот файл уже очищен.',
    working: 'Этот файл уже в работе.',
    off: 'Больше не показываю кнопку под вашими файлами в этой группе. /clean работает как раньше. Вернуть: /on',
    on: 'Снова показываю кнопку под вашими файлами.',
    summary: 'Готово. Очищено: {done} из {n}.',
    sumNothing: 'Без скрытых данных: {n}',
    sumSkipped: 'Формат не поддерживается: {n}',
    sumFailed: 'Не получилось: {n}. Такие файлы не отправляйте как чистые.',
  },
  en: {
    start: 'Send a file to the group — photo, video, audio, PDF or document — and I will return it without hidden data: location, phone model, dates, author, edit history.\n\nSend it as a <b>file</b>, not as a photo, so Telegram does not recompress it.\n\nA clean button appears under each file, compressed or not, and I check them all. You can also reply to a file with <code>/clean</code>.\n\nDon\'t want the button under your files? /off, back with /on.\n\nA file reaches the bot\'s server only when you ask, and is deleted right after the reply. The bot does not read other group messages. It keeps only message numbers and statuses for a week, no files. If the file must never leave your device, use the site: https://unmeta.nolim.cloud',
    queued: 'Queued…',
    downloading: 'Getting the file…',
    cleaning: 'Cleaning…',
    progress: 'Cleaning: {done} of {n} done…',
    removed: 'Removed: {list}',
    leftover: 'Could not remove: {list}',
    nothing: 'No hidden data: checked, the file is clean.',
    photoNote: 'Checked this photo: no hidden data. Telegram compressed it when it was sent. To keep quality, send photos as files.',
    text: 'Plain text has nowhere to hide data about you. Just check the text itself.',
    unsupported: 'I can\'t clean this format yet. Your file is fine, I didn\'t touch it.',
    tooBig: 'The file is over 2 GB: Telegram won\'t let me download it.',
    tooBigDoc: 'This document or photo is too big for me yet. Try the site: https://unmeta.nolim.cloud',
    failed: 'Couldn\'t clean this file. Don\'t share it as clean.',
    corrupt: 'Couldn\'t open the file: it may be damaged.',
    replyToFile: 'Reply /clean to a message with a file.',
    offer: '<b>{name}</b> may contain hidden data.',
    offerMany: 'Files: {n}. They may contain hidden data.',
    btnClean: 'Remove metadata',
    btnCleanMany: 'Clean all: {n}',
    gone: 'This button is out of date. Reply /clean to a message with a file.',
    already: 'This file is already clean.',
    working: 'This file is already being cleaned.',
    off: 'No more buttons under your files in this group. /clean still works. Bring them back: /on',
    on: 'Buttons are back under your files.',
    summary: 'Done. Cleaned: {done} of {n}.',
    sumNothing: 'No hidden data: {n}',
    sumSkipped: 'Unsupported format: {n}',
    sumFailed: 'Failed: {n}. Don\'t share those as clean.',
  },
};
type Lang = keyof typeof T;
const COPY = { ru: ruCopy, en: enCopy };
const langOf = (u?: { language_code?: string }): Lang => (u?.language_code?.startsWith('ru') ? 'ru' : 'en');
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
const SENDS = new Set(['sendDocument', 'sendVideo', 'sendAudio', 'sendAnimation', 'sendVoice', 'sendVideoNote']);
/** Waits out Telegram's rate limit and network hiccups. Never repeats a send whose fate is unknown: the job's retry decides. */
async function tg<R = any>(method: string, params: object = {}): Promise<R> {
  for (let i = 0; ; i++) {
    try { return await post(method, params, method === 'getUpdates' ? 70_000 : method === 'getFile' || SENDS.has(method) ? 2_400_000 : 30_000); }
    catch (e) {
      if (e instanceof ApiError && e.code === 429 && i < 10) { await sleep((e.parameters?.retry_after ?? 5) * 1000 * SLEEP_SCALE); continue; }
      if (!(e instanceof ApiError) && !SENDS.has(method) && i < 3) { await sleep(1000 * (i + 1) * SLEEP_SCALE); continue; }
      throw e;
    }
  }
}
/** Status text is decoration: never wait for it, never fail because of it. */
const soft = (method: string, params: object) => post(method, params, 30_000).catch(() => {});
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
const db = await (async () => { await import('node:fs/promises').then((f) => f.mkdir(WORK, { recursive: true })); return openDb(DB_FILE); })();
const tx = <R>(fn: () => R): R => {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
};
const q = (sql: string) => db.prepare(sql);
const jobIn = (chat: number, message: number) => q('SELECT * FROM jobs WHERE chat_id = ? AND message_id = ?').get(chat, message) as Job | undefined;
const batchById = (id: number) => q('SELECT * FROM batches WHERE id = ?').get(id) as Batch | undefined;
const isMuted = (chat: number, user: number) => !!q('SELECT 1 FROM muted WHERE chat_id = ? AND user_id = ?').get(chat, user);
function setJob(id: number, status: JobStatus, fields: { error?: string | null; result_id?: number | null; next_at?: number } = {}) {
  const ended = status === 'done' || status === 'nothing' || status === 'skipped' || status === 'failed';
  q(`UPDATE jobs SET status = ?, error = COALESCE(?, error), result_id = COALESCE(?, result_id), next_at = ?, updated_at = ?
     ${ended ? ', file_id = NULL, file_name = NULL, input = NULL, shape = NULL' : ''} WHERE id = ?`)
    .run(status, fields.error ?? null, fields.result_id ?? null, fields.next_at ?? 0, Date.now(), id);
}
function migrate(from: number, to: number) {
  tx(() => {
    q('INSERT OR REPLACE INTO state VALUES (?, ?)').run(`moved:${from}`, String(to)); // updates sent just before the move still carry the old id
    q('UPDATE OR IGNORE jobs SET chat_id = ? WHERE chat_id = ?').run(to, from);
    q('UPDATE batches SET chat_id = ? WHERE chat_id = ?').run(to, from);
    q('UPDATE OR IGNORE muted SET chat_id = ? WHERE chat_id = ?').run(to, from);
  });
}
function newBatch(chat: number, thread: number | null, user: number, lang: string, replyTo: number, status: Batch['status']) {
  const now = Date.now();
  return Number(q('INSERT INTO batches (chat_id, thread_id, user_id, lang, reply_to, status, last_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(chat, thread, user, lang, replyTo, status, now, now, now).lastInsertRowid);
}
function addJob(chat: number, thread: number | null, message: number, user: number, lang: string, item: Item, batch: number, status: JobStatus) {
  const now = Date.now();
  q('INSERT INTO jobs (chat_id, thread_id, message_id, user_id, lang, file_id, file_name, file_size, photo, shape, batch_id, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(chat, thread, message, user, lang, item.media.file_id, item.name, item.media.file_size ?? 0, item.photo ? 1 : 0, JSON.stringify(item.shape), batch, status, now, now);
}

// ---------- offering the button ----------
const threadOf = (m: any): number | null => (m.is_topic_message ? m.message_thread_id : null);
const senderOf = (m: any): number => (m.from?.is_bot && m.sender_chat ? m.sender_chat.id : m.from?.id ?? m.sender_chat?.id ?? m.chat.id);

function offer(m: any, user: number, lang: string) {
  const chat = m.chat.id, thread = threadOf(m);
  if (jobIn(chat, m.message_id)) return; // Telegram repeated an update
  tx(() => {
    const open = q(`SELECT * FROM batches WHERE chat_id = ? AND thread_id IS ? AND user_id = ? AND status = 'open'`).get(chat, thread, user) as Batch | undefined;
    const batch = open?.id ?? newBatch(chat, thread, user, lang, m.message_id, 'open');
    addJob(chat, thread, m.message_id, user, lang, mediaOf(m)!, batch, 'offered');
    q('UPDATE batches SET last_at = ? WHERE id = ?').run(Date.now(), batch);
  });
}

async function showOffers() {
  const now = Date.now();
  for (const b of q(`SELECT * FROM batches WHERE status = 'open' AND (last_at < ? OR created_at < ?)`).all(now - WINDOW, now - WINDOW_MAX) as unknown as Batch[]) {
    const jobs = q(`SELECT * FROM jobs WHERE batch_id = ? AND status = 'offered'`).all(b.id) as unknown as Job[];
    if (!jobs.length) { q('DELETE FROM batches WHERE id = ?').run(b.id); continue; }
    const t = texts(b.lang), n = jobs.length;
    try {
      const m = await say(b.chat_id, b.thread_id, n === 1 ? fmt(t.offer, { name: esc(jobs[0].file_name ?? '') }) : fmt(t.offerMany, { n }), b.reply_to,
        { reply_markup: { inline_keyboard: [[{ text: n === 1 ? t.btnClean : fmt(t.btnCleanMany, { n }), callback_data: `b:${b.id}` }]] } });
      q(`UPDATE batches SET status = 'offered', prompt_id = ?, updated_at = ? WHERE id = ?`).run(m.message_id, Date.now(), b.id);
    } catch (e) {
      if (!(e instanceof ApiError) || e.code === 429 || e.code >= 500) continue; // Telegram or the network: the next tick tries again
      console.error('offer failed:', e instanceof Error ? e.message : e);
      const error = `offer-failed: ${e instanceof Error ? e.message : e}`.slice(0, 120);
      tx(() => { for (const j of jobs) setJob(j.id, 'failed', { error }); q(`UPDATE batches SET status = 'finished', updated_at = ? WHERE id = ?`).run(Date.now(), b.id); });
    }
  }
}

// ---------- /clean ----------
async function cleanRequest(m: any, target: any, user: number, lang: string) {
  const chat = m.chat.id, t = texts(lang), item = mediaOf(target), thread = threadOf(m) ?? threadOf(target);
  if (!item) return void await say(chat, thread, t.replyToFile, m.message_id);
  const seen = jobIn(chat, target.message_id);
  if (seen?.status === 'done') return void await say(chat, thread, t.already, seen.result_id ?? target.message_id);
  if (seen && ['queued', 'running', 'sending'].includes(seen.status)) return void await say(chat, thread, t.working, target.message_id);
  if (seen?.status === 'nothing') return void await say(chat, thread, seen.photo ? t.photoNote : t.nothing, target.message_id);
  const batch = tx(() => {
    const id = newBatch(chat, thread, user, lang, target.message_id, 'queued');
    if (seen) q(`UPDATE jobs SET batch_id = ?, status = 'queued', file_id = ?, file_name = ?, file_size = ?, shape = ?, attempts = 0, next_at = 0, error = NULL, updated_at = ? WHERE id = ?`)
      .run(id, item.media.file_id, item.name, item.media.file_size ?? 0, JSON.stringify(item.shape), Date.now(), seen.id);
    else addJob(chat, thread, target.message_id, user, lang, item, id, 'queued');
    return id;
  });
  if (seen) await settle(seen.batch_id); // its old pack may be empty now
  const s = await say(chat, thread, t.queued, target.message_id).catch(() => null);
  if (s) q('UPDATE batches SET prompt_id = ? WHERE id = ?').run(s.message_id, batch);
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

function isolate(path: string, name: string, size: number): Promise<Done> {
  return new Promise((resolve) => {
    const c = fork(join(import.meta.dirname, 'worker.mjs'), { detached: true, execArgv: ['--max-old-space-size=450'], stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let answer: Done | undefined;
    c.once('message', (m) => { answer = m as unknown as Done; });
    const hung = setTimeout(() => { try { process.kill(-c.pid!, 'SIGKILL'); } catch { /* already gone */ } }, Math.max(JOB_MIN, size / BYTES_PER_MS)); // the group: ffmpeg too
    c.on('exit', (code, signal) => { clearTimeout(hung); resolve(answer ?? { outcome: 'error', error: `worker-died:${signal ?? code}` }); });
    c.send({ path, name });
  });
}

const sweep = async () => { for (const n of await readdir(WORK).catch(() => [] as string[])) if (n.startsWith('job-')) await rm(join(WORK, n), { recursive: true, force: true }); };

async function hasRoom(size: number) {
  const s = await statfs(WORK);
  return s.bavail * s.bsize > size * 3.2 + 300 * 1024 ** 2; // original + clean copy + a third while the MP4 index moves
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

async function process1(job: Job) {
  q(`UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at = ? WHERE id = ?`).run(Date.now(), job.id);
  job.attempts++;
  await progress(job.batch_id);
  let input: string | undefined;
  try {
    if (!(await hasRoom(job.file_size))) return retryLater(job, 'no-disk-space');
    input = (await tg<{ file_path: string }>('getFile', { file_id: job.file_id })).file_path;
    q('UPDATE jobs SET input = ? WHERE id = ?').run(input, job.id);
    const d = await isolate(input, job.file_name ?? 'file', job.file_size);
    if (d.outcome === 'nothing') return setJob(job.id, 'nothing');
    if (d.outcome === 'text' || d.outcome === 'unsupported' || d.outcome === 'too-big') return setJob(job.id, 'skipped', { error: d.outcome });
    if (d.outcome === 'error') {
      if (/unsupported|no-av-streams/.test(d.error)) return setJob(job.id, 'skipped', { error: 'unsupported' });
      if (/Error opening|invalid|corrupt|not a valid|truncated|moov atom|ffmpeg exit|unexpected|No PDF header|Failed to parse/i.test(d.error)) return setJob(job.id, 'skipped', { error: 'corrupt' });
      if (d.error.startsWith('verify-failed')) return setJob(job.id, 'failed', { error: d.error.slice(0, 300) }); // never hand out a file that failed the check
      return retryLater(job, d.error.slice(0, 300));
    }
    const out = join(d.out, '..', d.name);
    await rename(d.out, out);
    setJob(job.id, 'sending');
    const t = texts(job.lang);
    const caption = [
      d.removed.length ? fmt(t.removed, { list: d.removed.map((c) => catName(job.lang, c)).join(', ') }) : '',
      d.left.length ? fmt(t.leftover, { list: d.left.map((c) => catName(job.lang, c)).join(', ') }) : '',
    ].filter(Boolean).join('\n');
    const chat = (q('SELECT chat_id FROM jobs WHERE id = ?').get(job.id) as { chat_id: number }).chat_id; // a group can migrate mid-queue
    const call = sendCall(JSON.parse(job.shape ?? '{"type":"document"}') as Shape, out, d.thumb, caption);
    const sent = await inChat(chat, (c) => tg<{ message_id: number }>(call.method, { chat_id: c, ...call.params, ...place(job.thread_id, job.message_id) }));
    setJob(job.id, 'done', { result_id: sent.message_id, error: null });
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    console.error(`job ${job.id} failed: ${msg}`); // ids only: no file names or contents in logs
    if (e instanceof ApiError && e.code === 403) return botRemoved(job.chat_id);
    if (e instanceof ApiError && e.code === 429) { // not the file's fault: no attempt spent
      q('UPDATE jobs SET attempts = attempts - 1 WHERE id = ?').run(job.id);
      return setJob(job.id, 'queued', { next_at: Date.now() + 1000 * SLEEP_SCALE * (e.parameters?.retry_after ?? 5) });
    }
    if (e instanceof ApiError && e.code === 400) return setJob(job.id, 'failed', { error: msg }); // a wrong request stays wrong
    retryLater(job, msg);
  } finally {
    if (input) await unlink(input).catch(() => {}); // the Bot API server's copy of the original
    await sweep();
    await settle(job.batch_id);
  }
}

async function progress(id: number) {
  const b = batchById(id);
  if (!b?.prompt_id) return;
  const t = texts(b.lang);
  const c = q(`SELECT COUNT(*) AS n, SUM(status IN ${ENDED}) AS ended FROM jobs WHERE batch_id = ?`).get(id) as { n: number; ended: number };
  const now = Date.now();
  if (now - b.last_edit < EDIT_EVERY) return;
  q('UPDATE batches SET last_edit = ? WHERE id = ?').run(now, id);
  await edit(b.chat_id, b.prompt_id, c.n > 1 ? fmt(t.progress, { done: c.ended ?? 0, n: c.n }) : t.cleaning);
}

const reasonText = (t: (typeof T)['ru'], error: string | null) =>
  error === 'text' ? t.text : error === 'too-big' ? t.tooBigDoc : error === 'corrupt' ? t.corrupt : t.unsupported;

/** When a batch's last file ends: one short result in place of the button, not a message per file. */
async function settle(id: number) {
  const b = batchById(id);
  if (!b || b.status === 'finished') return;
  const jobs = q('SELECT * FROM jobs WHERE batch_id = ?').all(id) as unknown as Job[];
  if (jobs.some((j) => !ENDED.includes(`'${j.status}'`))) return;
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
    text = j.status === 'done' ? null : j.status === 'nothing' ? (j.photo ? t.photoNote : t.nothing) : j.status === 'failed' ? t.failed : reasonText(t, j.error);
  } else {
    text = [fmt(t.summary, { done: count('done'), n: jobs.length }), count('nothing') ? fmt(t.sumNothing, { n: count('nothing') }) : '', count('skipped') ? fmt(t.sumSkipped, { n: count('skipped') }) : '', count('failed') ? fmt(t.sumFailed, { n: count('failed') }) : ''].filter(Boolean).join('\n');
  }
  if (jobs.some((j) => j.error === 'bot-removed')) return;
  if (b.prompt_id) { if (text) await inChat(b.chat_id, (c) => tg('editMessageText', { chat_id: c, message_id: b.prompt_id, text, parse_mode: 'HTML' })).catch(() => {}); else await soft('deleteMessage', { chat_id: b.chat_id, message_id: b.prompt_id }); }
  else if (text) await say(b.chat_id, b.thread_id, text, b.reply_to).catch(() => {});
}

// ---------- updates ----------
let me = '';
async function onMessage(m: any) {
  if (m.chat.type !== 'group' && m.chat.type !== 'supergroup') return; // groups only
  if (m.migrate_to_chat_id) return migrate(m.chat.id, m.migrate_to_chat_id);
  const moved = q('SELECT value FROM state WHERE key = ?').get(`moved:${m.chat.id}`) as { value: string } | undefined;
  if (moved) m.chat.id = Number(moved.value);
  const chat = m.chat.id, lang = langOf(m.from), user = senderOf(m), t = T[lang];
  const cmd = String(m.text ?? m.caption ?? '').match(/^\/(\w+)(@\w+)?/);
  if (cmd?.[2] && cmd[2].slice(1).toLowerCase() !== me.toLowerCase()) return; // a command for another bot
  switch (cmd?.[1]) {
    case 'start': case 'help': return void await say(chat, threadOf(m), t.start, m.message_id);
    case 'off': q('INSERT OR IGNORE INTO muted VALUES (?, ?)').run(chat, user); return void await say(chat, threadOf(m), t.off, m.message_id);
    case 'on': q('DELETE FROM muted WHERE chat_id = ? AND user_id = ?').run(chat, user); return void await say(chat, threadOf(m), t.on, m.message_id);
    case 'clean': {
      const target = mediaOf(m) ? m : m.reply_to_message && mediaOf(m.reply_to_message) ? m.reply_to_message
        : m.external_reply && mediaOf(m.external_reply) ? { ...m.external_reply, message_id: m.message_id } : m; // a reply to a file from another chat
      return cleanRequest(m, target, user, lang);
    }
  }
  if (offerable(m) && !isMuted(chat, user)) offer(m, user, lang);
}

async function onCallback(q_: any) {
  const m = q_.message, lang = langOf(q_.from), [kind, value] = String(q_.data ?? '').split(':');
  if (m?.chat.type === 'private') return void await soft('answerCallbackQuery', { callback_query_id: q_.id });
  if (kind === 'b') {
    const id = Number(value);
    const pressed = tx(() => {
      const n = q(`UPDATE batches SET status = 'queued', updated_at = ? WHERE id = ? AND status = 'offered'`).run(Date.now(), id).changes;
      if (n) q(`UPDATE jobs SET status = 'queued', updated_at = ? WHERE batch_id = ? AND status = 'offered'`).run(Date.now(), id);
      return Boolean(n);
    });
    await soft('answerCallbackQuery', { callback_query_id: q_.id, ...(batchById(id) ? {} : { text: T[lang].gone }) });
    if (pressed && m) await edit(m.chat.id, m.message_id, T[lang].queued);
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
async function updatesLoop() {
  for (let offset = 0; ;) {
    let updates: any[] = [];
    try { updates = await tg('getUpdates', { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] }); }
    catch (e) { console.error('getUpdates:', e instanceof Error ? e.message : e); await sleep(5000 * SLEEP_SCALE); continue; }
    for (const u of updates) {
      offset = u.update_id + 1;
      try { if (u.message) await onMessage(u.message); else if (u.callback_query) await onCallback(u.callback_query); }
      catch (e) { console.error('update failed:', e instanceof Error ? e.message : e); }
    }
  }
}

async function queueLoop() {
  for (;;) {
    const job = nextJob();
    if (job) await process1(job).catch((e) => console.error('queue:', e instanceof Error ? e.message : e));
    else await sleep(TICK);
  }
}

let purged = 0;
async function timersLoop() {
  for (;;) {
    try {
      await showOffers();
      if (Date.now() - purged > 3600_000) {
        purged = Date.now();
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

/** After a crash or restart: whatever was in progress goes back in line, its leftovers go away. */
async function recover() {
  await sweep();
  for (const part of CACHE_PARTS) { // nothing is in work yet: a file left here lost its job in the crash
    for (const n of await readdir(join(CACHE, part)).catch(() => [] as string[])) await rm(join(CACHE, part, n), { force: true });
  }
  for (const j of q(`SELECT * FROM jobs WHERE status IN ('running', 'sending')`).all() as unknown as Job[]) {
    if (j.input) await unlink(j.input).catch(() => {});
    q('UPDATE jobs SET input = NULL WHERE id = ?').run(j.id);
    retryLater(j, 'interrupted');
    await settle(j.batch_id);
  }
}

async function main() {
  if (!TOKEN) throw new Error('BOT_TOKEN is not set');
  await recover();
  me = (await tg<{ username: string }>('getMe')).username;
  await tg('deleteMyCommands'); // the list once shown in private chats
  for (const [l, code] of [['ru', 'ru'], ['en', '']] as const) {
    await tg('setMyCommands', { scope: { type: 'all_group_chats' }, commands: [
      { command: 'start', description: l === 'ru' ? 'Как пользоваться' : 'How to use' },
      { command: 'clean', description: l === 'ru' ? 'Очистить файл (ответом на сообщение)' : 'Clean a file (as a reply)' },
      { command: 'off', description: l === 'ru' ? 'Не показывать кнопку под моими файлами' : 'No button under my files' },
      { command: 'on', description: l === 'ru' ? 'Показывать кнопку под моими файлами' : 'Button under my files' },
    ], ...(code ? { language_code: code } : {}) });
  }
  console.log(`@${me} ready`);
  await Promise.all([updatesLoop(), queueLoop(), timersLoop()]);
}

void main().catch((e) => { console.error(e); process.exit(1); });
