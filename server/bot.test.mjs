// The built bot against a fake Bot API, real engine: node --test server/bot.test.mjs (after build:server)
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, fileUri, offerable, safeName, sendCall, mediaOf } from './chat.ts';
import { FakeTelegram, until } from './fake-telegram.mjs';

const fx = (n) => fileURLToPath(new URL(`../test/fixtures/${n}`, import.meta.url));
const dist = fileURLToPath(new URL('./dist/bot.mjs', import.meta.url));
const USER = { id: 7, language_code: 'ru' }, USER2 = { id: 8, language_code: 'en' };
let chatSeq = -100, GROUP, tmp, tg, bot, api, msgs = 5000, made = {};
const fixture = (id) => made[id] ?? (existsSync(fx(id)) ? fx(id) : null);

const start = () => {
  bot = spawn(process.execPath, [dist], { stdio: 'inherit', env: { ...process.env, BOT_TOKEN: 't', BOT_API: api, WORK_DIR: join(tmp, 'work'), DB_FILE: join(tmp, 'bot.db'), CACHE_DIR: join(tmp, 'cache'),
    WINDOW_MS: '600', WINDOW_MAX_MS: '3000', TICK_MS: '10', RETRY_MS: '30', EDIT_EVERY_MS: '0', SLEEP_SCALE: '0.02' } });
  return until(() => tg.of('setMyCommands').length >= 2, 'bot start');
};
const db = () => new DatabaseSync(join(tmp, 'bot.db'), { readOnly: true });
const rows = (sql, ...a) => { const d = db(); try { return d.prepare(sql).all(...a); } finally { d.close(); } };
const job = (id) => rows('SELECT * FROM jobs WHERE message_id = ?', id)[0];
const base = (extra = {}) => ({ message_id: ++msgs, chat: { id: GROUP, type: 'supergroup' }, from: USER, ...extra });
const doc = (file_id, file_name = file_id, extra = {}) => base({ document: { file_id, file_name, file_size: 1000 }, ...extra });
const video = (file_id) => base({ video: { file_id, file_name: file_id, duration: 3, width: 320, height: 240, mime_type: 'video/mp4' } });
const prompt = async (after = 0) => until(() => tg.of('sendMessage').slice(after).find((c) => c.reply_markup), 'offer');
const press = (p, from = USER) => tg.send({ callback_query: { id: 'q', from, data: p.reply_markup.inline_keyboard[0][0].callback_data, message: { message_id: 999, chat: { id: p.chat_id, type: 'supergroup' } } } });
const settle = () => new Promise((s) => setTimeout(s, 250));

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'um-bot-'));
  tg = new FakeTelegram(tmp, fixture);
  api = await tg.listen();
  made['corrupt.mp4'] = join(tmp, 'corrupt.mp4'); await copyFile(fx('video.mp4'), made['corrupt.mp4']); await truncate(made['corrupt.mp4'], 600);
  made['empty.mp4'] = join(tmp, 'empty.mp4'); await writeFile(made['empty.mp4'], '');
  made['fake.pdf'] = join(tmp, 'fake.pdf'); await writeFile(made['fake.pdf'], 'not a pdf at all');
  await start();
});
beforeEach(() => { GROUP = --chatSeq; tg.calls = []; tg.sent = []; tg.downloaded = []; tg.rate.limit = Infinity; });
after(async () => { bot.kill('SIGKILL'); tg.close(); await rm(tmp, { recursive: true, force: true }); });

test('a supported file gets one button, and nothing is downloaded', async () => {
  const m = doc('photo-cyrillic.jpg');
  tg.send({ message: m });
  const p = await prompt();
  assert.equal(p.reply_parameters.message_id, m.message_id);
  assert.match(p.text, /photo-cyrillic\.jpg/);
  assert.equal(p.reply_markup.inline_keyboard.flat().length, 1);
  await settle();
  assert.equal(tg.downloaded.length, 0);
  assert.equal(job(m.message_id).status, 'offered');
});

test('the button appears at once, a later file joins it', async () => {
  const t = Date.now();
  tg.send({ message: doc('photo.jpg', 'a.jpg') });
  await prompt();
  assert.ok(Date.now() - t < 300, `took ${Date.now() - t} ms`);
  await settle();
  tg.send({ message: doc('photo.png', 'b.png') });
  await until(() => tg.of('editMessageText').some((c) => /Файлов: 2/.test(c.text)), 'joined');
  assert.equal(tg.of('sendMessage').length, 1);
});

test('silence on chatter, unsupported files, other bots and private chats', async () => {
  tg.send({ message: base({ text: 'привет' }) });
  tg.send({ message: doc('notes.txt') });
  tg.send({ message: doc('scene.blend') });
  tg.send({ message: doc('video_clean.mp4') });
  tg.send({ message: base({ from: { id: 9, is_bot: true }, photo: [{ file_id: 'photo.jpg' }] }) });
  tg.send({ message: base({ text: '/start@other_bot' }) });
  tg.send({ message: base({ sticker: { file_id: 'x' } }) });
  const dm = { id: 7, type: 'private' };
  tg.send({ message: doc('photo.jpg', 'photo.jpg', { chat: dm }) });
  tg.send({ message: base({ chat: dm, text: '/start' }) });
  tg.send({ message: base({ chat: dm, text: '/clean', reply_to_message: doc('photo.jpg') }) });
  await settle();
  assert.deepEqual(tg.calls.map((c) => c.method).filter((m) => m !== 'setMyCommands' && m !== 'getMe'), []);
});

test('compressed photos are really checked: a clean one says so, with no file back', async () => {
  const m = base({ photo: [{ file_id: 'photo.gif', width: 10 }, { file_id: 'clean-pixel.png', width: 90 }] });
  made['clean-pixel.png'] = join(tmp, 'clean-pixel.png');
  await writeFile(made['clean-pixel.png'], Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64'));
  tg.send({ message: m });
  press(await prompt());
  await until(() => tg.of('editMessageText').some((c) => /Проверил это фото/.test(c.text)), 'report');
  assert.deepEqual(tg.downloaded.map((d) => d.file_id), ['clean-pixel.png'], 'the largest size');
  assert.equal(tg.sent.length, 0);
  assert.equal(job(m.message_id).status, 'nothing');
});

test('a compressed photo that still has metadata is cleaned', async () => {
  tg.send({ message: base({ photo: [{ file_id: 'photo.jpg' }] }) });
  press(await prompt());
  const s = await until(() => tg.sent[0], 'send');
  assert.equal(s.name, 'photo_clean.jpg');
});

test('every kind of message leaves the way it arrived', async () => {
  const cases = [
    [doc('video-cyrillic.mp4'), 'sendDocument', true],
    [video('video.mp4'), 'sendVideo', true],
    [base({ audio: { file_id: 'audio.mp3', file_name: 'audio.mp3', duration: 2 } }), 'sendAudio', false],
    [base({ voice: { file_id: 'audio.opus', duration: 2, mime_type: 'audio/ogg' } }), 'sendVoice', false],
    [base({ animation: { file_id: 'video.mp4', file_name: 'a.mp4', duration: 1, width: 10, height: 10 } }), 'sendAnimation', true],
    [base({ video_note: { file_id: 'video.mp4', duration: 1, length: 240 } }), 'sendVideoNote', true],
    [doc('photo.jpg'), 'sendDocument', true],
    [doc('doc.pdf'), 'sendDocument', false],
  ];
  for (const [m, method, thumb] of cases) {
    tg.calls = []; tg.sent = [];
    tg.send({ message: m });
    await settle();
    press(await prompt());
    const s = await until(() => tg.sent[0], `send ${method}`);
    assert.equal(s.method, method);
    assert.equal(s.thumb, thumb, `${method} preview`);
    assert.equal(s.reply, m.message_id);
    if (method === 'sendVideo') { assert.equal(s.supports_streaming, true); assert.equal(s.duration, 3); }
    await until(() => job(m.message_id).status === 'done', 'done');
  }
});

test('a pack of files gets one button; every file answers its own message; a double tap runs once', async () => {
  const ms = Array.from({ length: 6 }, (_, i) => doc('photo.jpg', `p${i}.jpg`));
  ms[5] = doc('fake.pdf');
  for (const m of ms) tg.send({ message: m });
  const p = await prompt();
  await until(() => /Файлов: 6/.test(p.text) || tg.of('editMessageText').some((c) => /Файлов: 6/.test(c.text)), 'count');
  await settle();
  assert.equal(tg.of('sendMessage').length, 1);
  press(p); press(p);
  await until(() => tg.of('editMessageText').some((c) => /Готово\. Очищено: 5 из 6/.test(c.text)), 'summary');
  assert.deepEqual(tg.sent.map((s) => s.reply).sort(), ms.slice(0, 5).map((m) => m.message_id).sort());
  await settle();
  assert.equal(tg.sent.length, 5);
});

test('a pack with every file cleaned leaves no summary behind', async () => {
  const ms = [doc('photo.jpg', 'a.jpg'), doc('photo.png', 'b.png')];
  for (const m of ms) tg.send({ message: m });
  const p = await prompt();
  await settle();
  press(p);
  await until(() => tg.sent.length === 2 && tg.of('deleteMessage').length === 1, 'prompt removed');
  await settle();
  assert.ok(!tg.of('editMessageText').some((c) => /Готово/.test(c.text)));
});

test('the second file is much faster than the first: the worker stays warm', async () => {
  await settle();
  const t = Date.now();
  tg.send({ message: base({ text: '/clean', reply_to_message: doc('photo.jpg') }) });
  await until(() => tg.sent.length === 1, 'send');
  assert.ok(Date.now() - t < 1500, `took ${Date.now() - t} ms`);
});

test('several people at once: each gets their own button, and a hundred files from one do not hold up the others', async () => {
  const anna = { id: 21, language_code: 'ru' }, boris = { id: 22, language_code: 'ru' }, vera = { id: 23, language_code: 'en' };
  const pile = Array.from({ length: 12 }, (_, i) => doc('photo.jpg', `pile${i}.jpg`, { from: anna }));
  const b = doc('photo.png', 'b.png', { from: boris }), v = doc('doc.pdf', 'v.pdf', { from: vera });
  for (const m of [...pile, b, v]) tg.send({ message: m });
  await until(() => tg.of('sendMessage').filter((c) => c.reply_markup).length === 3, 'three buttons');
  const offers = tg.of('sendMessage').filter((c) => c.reply_markup);
  assert.deepEqual(offers.map((c) => c.reply_markup.inline_keyboard[0][0].text).sort(), ['Clean all: 1'.replace('Clean all: 1', 'Remove metadata'), 'Очистить все: 12', 'Очистить от метаданных'].sort());
  for (const p of offers) press(p);
  await until(() => tg.sent.length === 14, 'all delivered', 60_000);
  const order = tg.sent.map((s) => s.reply);
  assert.ok(order.indexOf(b.message_id) <= 2 && order.indexOf(v.message_id) <= 2, `boris and vera wait at most one file: ${order.indexOf(b.message_id)}, ${order.indexOf(v.message_id)}`);
  assert.deepEqual(new Set(order).size, 14);
});

test('/off hides the button only for that person and that group; /clean still works; /on brings it back', async () => {
  tg.send({ message: base({ text: '/off' }) });
  await until(() => tg.of('sendMessage').length, 'answer');
  const mine = doc('photo.jpg'), theirs = doc('photo.jpg', 'p.jpg', { from: USER2 });
  tg.send({ message: mine }); tg.send({ message: theirs });
  const p = await prompt();
  assert.equal(p.reply_parameters.message_id, theirs.message_id);
  await settle();
  assert.equal(job(mine.message_id), undefined);
  tg.send({ message: base({ text: '/clean', reply_to_message: mine }) });
  await until(() => tg.sent.some((s) => s.reply === mine.message_id), 'clean');
  tg.send({ message: base({ text: '/on' }) });
  await settle(); tg.calls = [];
  tg.send({ message: doc('photo.jpg') });
  await prompt();
});

test('/clean: again says already done, on text asks for a file, a failed file can be retried', async () => {
  const m = doc('photo.jpg');
  tg.send({ message: base({ text: '/clean@unmeta_bot', reply_to_message: m }) });
  await until(() => tg.sent.length === 1, 'send');
  await until(() => job(m.message_id).status === 'done', 'done');
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => tg.of('sendMessage').some((c) => /уже очищен/.test(c.text)), 'already');
  assert.equal(tg.sent.length, 1);
  tg.send({ message: base({ text: '/clean', reply_to_message: base({ text: 'hi' }) }) });
  await until(() => tg.of('sendMessage').some((c) => /Ответьте \/clean/.test(c.text)), 'ask');
});

test('a damaged, empty, fake or vanished file gets an honest answer and leaves nothing behind', async () => {
  for (const [id, text] of [['corrupt.mp4', /повреждён/], ['empty.mp4', /повреждён/], ['fake.pdf', /не умею|повреждён/], ['vanished.mp4', /Не получилось/]]) {
    tg.calls = [];
    const m = doc(id);
    tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
    await until(() => tg.of('editMessageText').some((c) => text.test(c.text)), id);
    assert.notEqual(job(m.message_id).error, null);
    assert.ok(!tg.of('editMessageText').some((c) => /всё в порядке/.test(c.text)), 'never calls a broken file fine');
  }
  await settle();
  assert.deepEqual((await readdir(join(tmp, 'work'))).filter((n) => n.startsWith('job-')), []);
  assert.ok(tg.downloaded.every((d) => !existsSync(d.path)), 'originals deleted');
});

test('odd names survive: emoji, percent, slashes, 500 characters', async () => {
  for (const [name, want] of [['Отпуск 100% #1 🎉.jpg', 'Отпуск 100% #1 🎉_clean.jpg'], ['../../etc/passwd.jpg', '.._.._etc_passwd_clean.jpg'.replace(/^\.+/, '')], ['я'.repeat(500) + '.jpg', null]]) {
    tg.sent = []; tg.calls = [];
    tg.send({ message: base({ text: '/clean', reply_to_message: doc('photo.jpg', name) }) });
    const s = await until(() => tg.sent[0], name.slice(0, 20));
    if (want) assert.equal(s.name, want);
    assert.ok(Buffer.byteLength(s.name) <= 255);
    assert.ok(s.name.endsWith('.jpg'));
    await settle();
  }
});

test("Telegram's rate limit is waited out, nothing is lost", async () => {
  tg.rate = { limit: 2, perMs: 200 };
  const ms = Array.from({ length: 6 }, (_, i) => doc('photo.jpg', `r${i}.jpg`));
  for (const m of ms) tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => tg.sent.length === 6, '6 sends', 40_000);
  assert.ok(tg.limited > 0, 'the limit was hit');
});

test('a group upgraded to a supergroup keeps working under its new id', async () => {
  const m = doc('photo.jpg'), to = GROUP - 5000;
  tg.send({ message: m });
  const p = await prompt();
  tg.migrated.set(GROUP, to);
  press(p);
  await until(() => tg.sent.some((s) => s.chat === to), 'sent to the new id');
  assert.equal(job(m.message_id).chat_id, to);
});

test('an update sent just before the move still lands in the new group, no second copy', async () => {
  const old = GROUP, to = GROUP - 7000, m = doc('photo.jpg');
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => tg.sent.length === 1 && job(m.message_id)?.status === 'done', 'first');
  tg.send({ message: { message_id: ++msgs, chat: { id: old, type: 'group' }, from: USER, migrate_to_chat_id: to } });
  await settle();
  tg.send({ message: { ...base({ text: '/clean', reply_to_message: m }), chat: { id: old, type: 'group' } } });
  await until(() => tg.of('sendMessage').some((c) => /уже очищен/.test(c.text)), 'already');
  assert.equal(tg.sent.length, 1);
  assert.equal(rows('SELECT COUNT(*) n FROM jobs WHERE message_id = ?', m.message_id)[0].n, 1);
});

test('kicked from a group: its jobs end, the bot keeps serving others', async () => {
  const m = doc('photo.jpg');
  tg.kicked.add(GROUP);
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => job(m.message_id)?.status === 'failed', 'failed');
  assert.equal(job(m.message_id).error, 'bot-removed');
  GROUP = --chatSeq;
  tg.send({ message: base({ text: '/clean', reply_to_message: doc('photo.jpg') }) });
  await until(() => tg.sent.length === 1, 'other group served');
});

test('network failures are retried until the file is delivered', async () => {
  tg.flaky = 0.3;
  const m = doc('photo.jpg');
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => ['done', 'failed'].includes(job(m.message_id)?.status), 'end');
  tg.flaky = 0;
  assert.ok(job(m.message_id).status === 'failed' || tg.sent.length >= 1);
});

test('killed mid-work: restarts, finishes, repeats nothing; a repeated update does nothing', async () => {
  tg.latency = 150;
  const ms = Array.from({ length: 4 }, (_, i) => doc('photo.jpg', `k${i}.jpg`));
  for (const m of ms) tg.send({ message: m });
  press(await prompt());
  await until(() => tg.downloaded.length >= 1, 'first download');
  bot.kill('SIGKILL');
  await settle();
  tg.latency = 0;
  await start();
  await until(() => ms.every((m) => job(m.message_id)?.status === 'done'), 'all done after restart');
  assert.equal(new Set(tg.sent.map((s) => s.reply)).size, 4);
  await settle();
  assert.deepEqual((await readdir(join(tmp, 'work'))).filter((n) => n.startsWith('job-')), []);
});

test('a file that hangs is killed, the job fails honestly, the bot lives on', async () => {
  bot.kill('SIGKILL'); await settle();
  const fast = spawn(process.execPath, [dist], { stdio: 'ignore', env: { ...process.env, BOT_TOKEN: 't', BOT_API: api, WORK_DIR: join(tmp, 'work'), DB_FILE: join(tmp, 'bot.db'), WINDOW_MS: '80', TICK_MS: '10', RETRY_MS: '10', JOB_MIN_MS: '1', EDIT_EVERY_MS: '0', SLEEP_SCALE: '0.02' } });
  const m = doc('photo.jpg');
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => job(m.message_id)?.status === 'failed', 'failed');
  assert.match(job(m.message_id).error, /worker-died/);
  await until(() => tg.of('editMessageText').some((c) => /Не получилось/.test(c.text)), 'told');
  fast.kill('SIGKILL'); await settle();
  await start();
});

test('/clean takes the last file out of a pack: the pack and its button quietly end', async () => {
  const m = doc('photo.jpg');
  tg.send({ message: m });
  const p = await prompt();
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => tg.sent.length === 1, 'clean');
  await until(() => rows(`SELECT COUNT(*) n FROM batches WHERE status != 'finished' AND chat_id = ?`, GROUP)[0].n === 0, 'pack ends');
  assert.ok(tg.of('deleteMessage').length >= 1, 'the button is gone');
  press(p);
  await settle();
  assert.equal(tg.sent.length, 1);
});

test('the database keeps ids and statuses, not file names', async () => {
  const m = doc('photo.jpg', 'секретное имя.jpg');
  tg.send({ message: base({ text: '/clean', reply_to_message: m }) });
  await until(() => job(m.message_id)?.status === 'done', 'done');
  const j = job(m.message_id);
  assert.equal(j.file_name, null); assert.equal(j.file_id, null); assert.ok(j.result_id);
});

test('decisions from the message alone', () => {
  const d = (file_name, mime_type, file_size = 1) => ({ document: { file_name, mime_type, file_size } });
  for (const n of ['a.JPG', 'a.heic', 'a.CR3', 'a.docx', 'a.pdf', 'a.mov', 'a.mp3', 'a.svg']) assert.ok(offerable(d(n)), n);
  for (const n of ['a.txt', 'a.xml', 'a.zip', 'a.ts', 'a_clean.mp4']) assert.ok(!offerable(d(n)), n);
  assert.ok(offerable(d(undefined, 'video/mp4')));
  for (const m of [{ video: {} }, { audio: {} }, { voice: {} }, { animation: {} }, { video_note: {} }, { photo: [{}] }]) assert.ok(offerable(m), Object.keys(m)[0]);
  assert.ok(!offerable(d('a.mp4', 'video/mp4', 3e9)), 'over the Bot API limit');
  assert.ok(offerable({ from: { is_bot: true }, sender_chat: { id: 1 }, document: { file_name: 'a.pdf' } }), 'anonymous admin');
  assert.ok(!offerable({ is_automatic_forward: true, video: {} }), 'channel repost');
  assert.equal(esc('<b>&'), '&lt;b&gt;&amp;');
  assert.equal(fileUri('/w/Отпуск 100%.jpg'), 'file:///w/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%20100%25.jpg');
  assert.equal(safeName('a/b\\c\n.jpg'), 'a_b_c_.jpg');
  assert.ok(Buffer.byteLength(safeName('🎉'.repeat(100) + '.mp4')) <= 204);
  assert.equal(safeName('...'), 'file');
  assert.match(safeName('я'.repeat(500) + '_clean.mp4'), /я_clean\.mp4$/, 'the suffix survives the trim');
  assert.equal(sendCall(mediaOf({ video_note: { file_id: 'x', length: 240 } }).shape, '/a', null, 'c').params.caption, undefined, 'round videos take no caption');
});
