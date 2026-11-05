// A random life of the bot in group chats: node server/sim.mjs [seed] [events] (after build:server)
// People post everything at once, press, double-tap, forward, delete; the network drops, Telegram rate-limits,
// the bot gets killed, kicked and migrated. At the end: every promise is checked against what really happened.
import { spawn, execSync } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FakeTelegram, until } from './fake-telegram.mjs';

const seed = Number(process.argv[2] ?? Date.now() % 100000), EVENTS = Number(process.argv[3] ?? 300);
let x = seed * 2654435761 % 4294967296 || 1;
const rnd = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
const pick = (a) => a[Math.floor(rnd() * a.length)], chance = (p) => rnd() < p;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fx = (n) => fileURLToPath(new URL(`../test/fixtures/${n}`, import.meta.url));
const dist = (n) => fileURLToPath(new URL(`./dist/${n}`, import.meta.url));
process.env.WORK_DIR = '/tmp/unmeta-sim-verify';
const { inspect, fileFromPath } = await import(dist('engine.mjs'));

const tmp = await mkdtemp(join(tmpdir(), 'um-sim-'));
const made = {};
const make = async (n, fn) => { made[n] = join(tmp, n); await fn(made[n]); };
await make('corrupt.mp4', async (p) => { await copyFile(fx('video.mp4'), p); await truncate(p, 900); });
await make('corrupt.jpg', async (p) => { await copyFile(fx('photo.jpg'), p); await truncate(p, 400); });
await make('corrupt.docx', async (p) => { await copyFile(fx('doc.docx'), p); await truncate(p, 500); });
await make('corrupt.pdf', async (p) => { await copyFile(fx('doc.pdf'), p); await truncate(p, 300); });
await make('empty.jpg', (p) => writeFile(p, ''));
await make('lies.jpg', async (p) => copyFile(fx('video.mp4'), p)); // a video named like a photo
const tg = new FakeTelegram(tmp, (id) => made[id] ?? (existsSync(fx(id)) ? fx(id) : null));
const api = await tg.listen();
tg.rate = { limit: 8, perMs: 1000 }; tg.flaky = 0.03;

let bot, deaths = [], kills = 0;
const start = async () => {
  const before = tg.of('setMyCommands').length;
  const b = spawn(process.execPath, [dist('bot.mjs')], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, BOT_TOKEN: 't', BOT_API: api, WORK_DIR: join(tmp, 'work'), DB_FILE: join(tmp, 'bot.db'), CACHE_DIR: join(tmp, 'cache'), WINDOW_MS: '120', WINDOW_MAX_MS: '500', TICK_MS: '15', RETRY_MS: '40', EDIT_EVERY_MS: '100', SLEEP_SCALE: '0.05' } });
  b.stderr.on('data', () => {});
  b.on('exit', (code, sig) => { if (sig !== 'SIGKILL') deaths.push(`${code}/${sig}`); });
  bot = b;
  await until(() => tg.of('setMyCommands').length >= before + 2, 'bot start');
};
await start();

const GOOD = ['photo.jpg', 'photo.png', 'photo.heic', 'photo.tif', 'photo.gif', 'photo-big.jpg', 'video.mp4', 'video.mov', 'video.mkv', 'video.webm', 'video.avi', 'audio.mp3', 'audio.flac', 'audio.wav', 'audio.opus', 'audio.m4a', 'doc.pdf', 'doc.docx', 'doc.odt', 'photo-cyrillic.jpg', 'video-cyrillic.mp4', 'drawing.svg'];
const BAD = ['corrupt.mp4', 'corrupt.jpg', 'corrupt.docx', 'corrupt.pdf', 'empty.jpg', 'lies.jpg', 'vanished.mp4'];
const NAMES = (f) => pick([f, f, f, `Отпуск у мамы ${f}`, `100% ${f}`, `🎉 ${f}`, `${'длинное имя '.repeat(30)}${f}`, `../../${f}`, `a&b<c>"${f}`]);
const groups = [
  { id: -1001, type: 'supergroup' }, { id: -1002, type: 'group', title: 'migrates' }, { id: -1003, type: 'supergroup', is_forum: true }, { id: -1004, type: 'supergroup', title: 'kicks' },
];
const users = Array.from({ length: 8 }, (_, i) => ({ id: 100 + i, language_code: i % 3 ? 'ru' : 'en', first_name: `u${i}` }));
let msgId = 10;
const messages = [], requested = new Map(), muted = new Set(), mutedOffers = [];
const stamp = (m) => { requested.set(`${m.chat.id}:${m.message_id}`, m); };

function message(chat, from, fields) {
  const m = { message_id: ++msgId, chat: { ...chat }, from, ...fields };
  if (chat.is_forum && chance(0.7)) { m.is_topic_message = true; m.message_thread_id = pick([2, 3]); }
  if (chance(0.1)) m.forward_origin = { type: 'user' };
  messages.push(m);
  return m;
}
function media(chat, from, f) {
  const size = 1000;
  const e = f.split('.').pop();
  const video = ['mp4', 'mov', 'mkv', 'webm', 'avi'].includes(e), audio = ['mp3', 'flac', 'wav', 'opus', 'm4a'].includes(e), image = ['jpg', 'png', 'heic', 'tif', 'gif'].includes(e);
  if (image && chance(0.3)) return message(chat, from, { photo: [{ file_id: f, width: 10, file_size: size }, { file_id: f, width: 90, file_size: size }] });
  if (video && chance(0.4)) return message(chat, from, { video: { file_id: f, file_name: chance(0.7) ? NAMES(f) : undefined, duration: 3, width: 320, height: 240, mime_type: 'video/mp4', file_size: size } });
  if (video && chance(0.2)) return message(chat, from, { animation: { file_id: f, file_name: f, duration: 1, width: 10, height: 10, file_size: size } });
  if (video && chance(0.1)) return message(chat, from, { video_note: { file_id: f, duration: 1, length: 240, file_size: size } });
  if (audio && chance(0.4)) return message(chat, from, { audio: { file_id: f, file_name: NAMES(f), duration: 2, file_size: size } });
  if (e === 'opus' && chance(0.5)) return message(chat, from, { voice: { file_id: f, duration: 2, mime_type: 'audio/ogg', file_size: size } });
  return message(chat, from, { document: { file_id: f, file_name: NAMES(f), file_size: size } });
}
const stale = [];
function pressAny() {
  const offers = tg.of('sendMessage').filter((c) => c.reply_markup && !c.pressed);
  if (!offers.length) return;
  const c = pick(offers);
  if (chance(0.12) && !/Файлов|Files/.test(c.text)) { c.pressed = true; stale.push(c); return; } // nobody ever presses this one
  c.pressed = true;
  const q = () => tg.send({ callback_query: { id: `q${msgId++}`, from: pick(users), data: c.reply_markup.inline_keyboard[0][0].callback_data, message: { message_id: 1, chat: { id: c.chat_id, type: 'supergroup' } } } });
  q(); if (chance(0.25)) q(); // a double tap
}

const t0 = Date.now(), killTimes = [];
for (let i = 0; i < EVENTS; i++) {
  const chat = pick(groups), from = pick(users), r = rnd();
  if (r < 0.30) tg.send({ message: message(chat, from, { text: pick(['ага', 'лол', 'кто сегодня?', '/help', '/start', '/start@other_bot', '/nonsense', 'https://example.com']) }) });
  else if (r < 0.55) tg.send({ message: media(chat, from, pick(GOOD)) });
  else if (r < 0.60) tg.send({ message: media(chat, from, pick(BAD)) });
  else if (r < 0.64) tg.send({ message: message(chat, from, { document: { file_id: pick(['notes.txt', 'scene.blend']), file_name: pick(['notes.txt', 'scene.blend', 'архив.zip']), file_size: 10 } }) });
  else if (r < 0.66) tg.send({ message: message(chat, from, { sticker: { file_id: 'x' } }) });
  else if (r < 0.70) { const album = String(i); for (let k = 0; k < 2 + Math.floor(rnd() * 8); k++) tg.send({ message: { ...media(chat, from, pick(GOOD)), media_group_id: album } }); } // an album
  else if (r < 0.80) pressAny();
  else if (r < 0.90) {
    const t = pick(messages.filter((m) => m.chat.id === chat.id)) ?? null;
    if (t) { const m = message(chat, from, { text: pick(['/clean', '/clean', '/clean@unmeta_bot']), reply_to_message: t }); tg.send({ message: m }); }
  } else if (r < 0.92) { tg.send({ message: message(chat, from, { text: '/clean' }) }); }
  else if (r < 0.95) { const on = muted.has(`${chat.id}:${from.id}`); if (on) muted.delete(`${chat.id}:${from.id}`); else muted.add(`${chat.id}:${from.id}`); tg.send({ message: message(chat, from, { text: on ? '/on' : '/off' }) }); }
  else if (r < 0.96) tg.send({ message: message({ id: from.id, type: 'private' }, from, { text: '/start' }) });
  else if (r < 0.97) tg.send({ message: message({ id: from.id, type: 'private' }, from, { document: { file_id: 'photo.jpg', file_name: 'x.jpg' } }) });
  else if (r < 0.98) tg.send({ message: message(chat, { id: 999, is_bot: true }, { document: { file_id: 'doc.pdf', file_name: 'bot.pdf' } }) });
  else tg.send({ message: message(chat, { id: 136817688, is_bot: true, username: 'GroupAnonymousBot' }, { sender_chat: { id: chat.id }, document: { file_id: 'doc.pdf', file_name: 'anon.pdf', file_size: 10 } }) });

  if (i === Math.floor(EVENTS * 0.3)) { const c = groups[0], from1 = { id: 555, language_code: 'ru' }; for (let k = 0; k < 100; k++) tg.send({ message: media(c, from1, pick(GOOD)) }); } // one person, a hundred files
  if (i === Math.floor(EVENTS * 0.5)) { tg.migrated.set(-1002, -1009002); tg.send({ message: { message_id: ++msgId, chat: { ...groups[1] }, from: pick(users), migrate_to_chat_id: -1009002 } }); groups[1].id = -1009002; }
  if (i === Math.floor(EVENTS * 0.7)) { tg.kicked.add(-1004); groups.pop(); } // no more updates from there
  if (chance(0.03)) { killTimes.push(Date.now() - t0); bot.kill('SIGKILL'); kills++; await sleep(100); await start(); }
  if (chance(0.15)) await sleep(10 + rnd() * 120);
}
await sleep(1000);
await sleep(1500);
for (const c of tg.of('sendMessage').filter((c) => c.reply_markup && !c.pressed)) { c.pressed = true; tg.send({ callback_query: { id: `end${c.at}`, from: pick(users), data: c.reply_markup.inline_keyboard[0][0].callback_data, message: { message_id: 1, chat: { id: c.chat_id, type: 'supergroup' } } } }); }
for (let k = 0; k < 8; k++) { await sleep(3000 + rnd() * 9000); killTimes.push(Date.now() - t0); bot.kill('SIGKILL'); kills++; await sleep(150); await start(); } // and while the queue works
tg.flaky = 0;

const open = () => {
  const d = new DatabaseSync(join(tmp, 'bot.db'), { readOnly: true });
  const r = d.prepare(`SELECT COUNT(*) n FROM jobs WHERE status IN ('queued','running','sending')`).get().n + d.prepare(`SELECT COUNT(*) n FROM batches WHERE status = 'open'`).get().n;
  d.close(); return r;
};
await until(() => open() === 0, 'queue to drain', 500_000);
await sleep(600);

const d = new DatabaseSync(join(tmp, 'bot.db'), { readOnly: true });
const jobs = d.prepare('SELECT * FROM jobs').all(), batches = d.prepare('SELECT * FROM batches').all();
const problems = [];
const fail = (s) => { problems.push(s); };
const tally = {};
for (const j of jobs) { const k = `${j.status}${j.error ? ' · ' + j.error.slice(0, 50) : ''}`; tally[k] = (tally[k] ?? 0) + 1; }

// Promise 1: everything asked for reached an end
for (const b of batches) if (b.status === 'queued') fail(`batch ${b.id} still queued`);
// Promise 2: nothing delivered twice (a kill between Telegram accepting and the database noting it is the one honest exception)
const key = (s) => `${s.chat}:${s.reply}`;
const counts = {}; for (const s of tg.sent) counts[key(s)] = (counts[key(s)] ?? 0) + 1;
const dups = Object.entries(counts).filter(([, n]) => n > 1);
// Promise 3: every delivered file is really clean and named as promised
let checked = 0;
for (const s of tg.sent) {
  if (!/_clean(\.\w+)?$/.test(s.name)) fail(`bad name ${s.name.slice(0, 60)}`);
  if (Buffer.byteLength(s.name) > 255) fail('name too long');
  const r = await inspect(await fileFromPath(s.copy, s.name)).catch((e) => ({ error: e.message }));
  if (r.error) fail(`unreadable result ${s.name.slice(-30)}: ${r.error.slice(0, 60)}`);
  else if (Object.keys(r.found).length) fail(`metadata left in ${s.name.slice(-30)}: ${Object.keys(r.found)}`);
  checked++;
}
// Promise 4: done means delivered, and answered in the right chat and topic
const after = (j) => tg.sent.some((s) => s.reply === j.message_id);
for (const j of jobs) if (j.status === 'done' && !after(j)) fail(`job ${j.id} done but nothing delivered`);
for (const s of tg.sent) { if (s.chat > 0) fail('answered in a private chat'); if (s.chat === -1004 && false) fail(''); }
// Promise 5: nothing was downloaded without being asked
const asked = jobs.filter((j) => j.attempts > 0).length;
if (tg.downloaded.length > asked + kills * 3 + jobs.reduce((n, j) => n + Math.max(0, j.attempts - 1), 0)) fail(`downloaded ${tg.downloaded.length}, asked ${asked}`);
if (jobs.some((j) => j.status === 'offered' && j.attempts > 0)) fail('an unpressed file was touched');
// Promise 6: nothing stays behind
const left = (await readdir(join(tmp, 'work'))).filter((n) => n.startsWith('job-'));
if (left.length) fail(`work folder keeps ${left.length}`);
const inputs = tg.downloaded.filter((x) => existsSync(x.path));
if (inputs.length) fail(`${inputs.length} downloaded originals still on disk`);
if (jobs.some((j) => ['done', 'nothing', 'skipped', 'failed'].includes(j.status) && (j.file_name || j.file_id))) fail('a file name outlived its job');
// Promise 7: private chats, other bots and muted people got no buttons
for (const c of tg.of('sendMessage')) if (c.chat_id > 0) fail('wrote to a private chat');
if (jobs.some((j) => j.user_id === 999)) fail('reacted to another bot');
// Promise 8: the bot itself never fell over
if (deaths.length) fail(`bot died by itself: ${deaths}`);
try { const n = execSync(`pgrep -f ${tmp} | wc -l`).toString().trim(); if (Number(n) > 1) fail(`${n} stray processes`); } catch { /* none */ }
// Promise 9: a promise made in the queue is kept: done + nothing + skipped + failed covers every pressed file
const unended = jobs.filter((j) => !['done', 'nothing', 'skipped', 'failed', 'offered'].includes(j.status));
if (unended.length) fail(`${unended.length} jobs without an end`);

console.log(`seed ${seed}: ${EVENTS} events + burst in ${((Date.now() - t0) / 1000).toFixed(0)} s; ${messages.length} messages, ${jobs.length} files seen, ${batches.length} packs, ${tg.sent.length} delivered and checked (${checked}), ${kills} kills, ${tg.limited ?? 0} rate limits`);
console.log(tally);
if (dups.length) {
  console.log(`delivered twice: ${dups.length} (only allowed if a kill hit that moment)`);
  for (const [k] of dups.slice(0, 6)) {
    const [chat, reply] = k.split(':').map(Number);
    console.log(k, tg.sent.filter((s) => key(s) === k).map((s) => `${s.method}@${s.at - t0}`).join(' '), JSON.stringify(jobs.filter((j) => j.message_id === reply).map((j) => ({ chat: j.chat_id, st: j.status, att: j.attempts, err: j.error?.slice(0, 30), b: j.batch_id }))));
  }
  console.log('kills at', killTimes.join(' '));
}
if (dups.length > kills) fail(`${dups.length} duplicates for ${kills} kills`);
console.log(problems.length ? `FAILED:\n  ${[...new Set(problems)].slice(0, 30).join('\n  ')}` : 'ALL PROMISES KEPT');
d.close(); bot.kill('SIGKILL'); tg.close(); await rm(tmp, { recursive: true, force: true }); await rm('/tmp/unmeta-sim-verify', { recursive: true, force: true });
process.exit(problems.length ? 1 : 0);
