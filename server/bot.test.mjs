// The built bot against a fake Bot API: real engine, scripted Telegram. node --test server/bot.test.mjs (after build:server)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, metaText, offerable } from './chat.ts';

const fx = (n) => fileURLToPath(new URL(`../test/fixtures/${n}`, import.meta.url));
const dist = fileURLToPath(new URL('./dist/bot.mjs', import.meta.url));
const GROUP = { id: -100, type: 'supergroup' }, DM = { id: 7, type: 'private' }, USER = { id: 7, language_code: 'ru' };
let tmp, srv, bot, inputs = [], calls = [], queue = [], ids = 1000, update = 1;

const answer = (method, b) => {
  calls.push({ method, ...b });
  if (method === 'getMe') return { username: 'unmeta_bot' };
  if (method === 'sendMessage') return { message_id: ++ids };
  if (method === 'getFile') { const p = join(tmp, `in-${++ids}-${b.file_id}`); inputs.push(p); return copyFile(fx(b.file_id), p).then(() => ({ file_path: p })); }
  if (method === 'sendDocument') { const p = b.document.replace('file://', ''); assert.ok(existsSync(p), 'file to send exists'); return { message_id: ++ids }; }
  return true;
};
const send = (u) => queue.push({ update_id: update++, ...u });
const of = (m) => calls.filter((c) => c.method === m);
async function until(fn) {
  for (let i = 0; i < 400; i++) { const r = fn(); if (r) return r; await new Promise((s) => setTimeout(s, 25)); }
  assert.fail(`timed out; calls: ${calls.map((c) => c.method).join(',')}`);
}
/** Nothing is pending: the fake got its polls with an empty queue and no job is left. */
const settle = () => new Promise((s) => setTimeout(s, 300));
const doc = (name, chat = GROUP, extra = {}) => ({ message_id: ++ids, chat, from: USER, document: { file_id: name, file_name: name, file_size: 1000 }, ...extra });
const press = (data, fileMessage, chat = GROUP, statusId = ++ids) => send({ callback_query: { id: 'q', from: USER, data, message: { message_id: statusId, chat, reply_to_message: fileMessage } } });

before(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'um-bot-'));
  srv = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; }).on('end', async () => {
      const method = req.url.split('/').at(-1);
      if (method === 'getUpdates') {
        const offset = JSON.parse(body).offset;
        await new Promise((s) => setTimeout(s, 10));
        const result = queue.filter((u) => u.update_id >= offset);
        queue = queue.filter((u) => u.update_id < offset ? false : !result.includes(u));
        return res.end(JSON.stringify({ ok: true, result }));
      }
      try { res.end(JSON.stringify({ ok: true, result: await answer(method, JSON.parse(body || '{}')) })); }
      catch (e) { res.end(JSON.stringify({ ok: false, description: String(e) })); }
    });
  });
  await new Promise((s) => srv.listen(0, '127.0.0.1', s));
  bot = spawn(process.execPath, [dist], { stdio: 'inherit', env: { ...process.env, BOT_TOKEN: 't', BOT_API: `http://127.0.0.1:${srv.address().port}`, WORK_DIR: join(tmp, 'work'), SETTINGS_FILE: join(tmp, 'settings.json') } });
  await until(() => of('setMyCommands').length === 2);
});
after(async () => { bot.kill(); srv.closeAllConnections(); srv.close(); await rm(tmp, { recursive: true, force: true }); });

test('group: a supported file gets both buttons and nothing is downloaded', async () => {
  calls = [];
  const m = doc('photo-cyrillic.jpg');
  send({ message: m });
  const offer = await until(() => of('sendMessage')[0]);
  assert.equal(offer.reply_parameters.message_id, m.message_id);
  assert.deepEqual(offer.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['file:clean', 'file:meta']);
  assert.match(offer.text, /photo-cyrillic\.jpg/);
  await settle();
  assert.equal(of('getFile').length, 0);
});

test('group: the bot stays silent on everything else', async () => {
  calls = [];
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: 'привет' } });
  send({ message: doc('notes.txt') });
  send({ message: doc('scene.blend') });
  send({ message: doc('photo_clean.jpg') });
  send({ message: doc('photo.jpg', GROUP, { from: { id: 9, is_bot: true } }) });
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, photo: [{ file_id: 'photo.jpg' }] } });
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/start@other_bot' } });
  await settle(); await settle();
  assert.deepEqual(calls.filter((c) => c.method !== 'getMe' && c.method !== 'setMyCommands').map((c) => c.method), []);
});

test('group: "View metadata" shows values in place, keeps a clean button, hides coordinates', async () => {
  calls = [];
  const statusId = ++ids;
  press('file:meta', doc('photo-cyrillic.jpg'), GROUP, statusId);
  const report = await until(() => of('editMessageText').find((c) => /Алина Карабер/.test(c.text)));
  assert.equal(report.message_id, statusId);
  assert.deepEqual(report.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['file:clean']);
  assert.match(report.text, /Местоположение<\/b>\nесть/);
  assert.doesNotMatch(report.text, /\d+ deg|\d+\.\d{4}/);
  await settle();
  assert.equal(of('deleteMessage').length, 0, 'the report stays in the chat');
  assert.equal(of('sendDocument').length, 0);
});

test('group: "Remove metadata" replies to the file with the clean copy and leaves nothing behind', async () => {
  calls = [];
  const m = doc('video-cyrillic.mp4'), statusId = ++ids;
  press('file:clean', m, GROUP, statusId);
  const sent = await until(() => of('sendDocument')[0]);
  assert.equal(basename(sent.document), 'video-cyrillic_clean.mp4');
  assert.equal(sent.reply_parameters.message_id, m.message_id);
  assert.match(sent.caption, /Удалено:.*Автор/);
  await until(() => of('deleteMessage').some((c) => c.message_id === statusId));
  await settle();
  assert.deepEqual((await readdir(join(tmp, 'work'))).filter((n) => n.startsWith('job-')), []);
  assert.ok(inputs.every((p) => !existsSync(p)), 'the downloaded original is deleted');
});

test('a double tap runs the job once', async () => {
  calls = [];
  const m = doc('photo-cyrillic.jpg'), statusId = ++ids;
  press('file:clean', m, GROUP, statusId);
  press('file:clean', m, GROUP, statusId);
  await until(() => of('sendDocument').length);
  await settle();
  assert.equal(of('sendDocument').length, 1);
});

test('group: /clean and /meta work as a reply', async () => {
  calls = [];
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/meta@unmeta_bot', reply_to_message: doc('doc.pdf') } });
  await until(() => of('editMessageText').some((c) => /Что нашлось/.test(c.text)));
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/clean', reply_to_message: doc('doc.pdf') } });
  assert.equal(basename((await until(() => of('sendDocument')[0])).document), 'doc_clean.pdf');
});

test('group: /clean without a file asks for one; a deleted file message is explained', async () => {
  calls = [];
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/clean' } });
  await until(() => of('sendMessage').some((c) => /Ответьте \/clean или \/meta/.test(c.text)));
  press('file:clean', undefined);
  await until(() => of('answerCallbackQuery').some((c) => /удалено/.test(c.text)));
});

test('private chat: a file is cleaned right away, no buttons', async () => {
  calls = [];
  send({ message: doc('photo-cyrillic.jpg', DM) });
  await until(() => of('sendDocument')[0]);
  assert.ok(!calls.some((c) => c.reply_markup));
});

test('a failed job still cleans up and says so', async () => {
  calls = [];
  send({ message: doc('scene.blend', DM) });
  await until(() => of('sendMessage').some((c) => /не умею чистить/.test(c.text)));
  await settle();
  assert.deepEqual((await readdir(join(tmp, 'work'))).filter((n) => n.startsWith('job-')), []);
});

test('file checks from the message alone', () => {
  const d = (file_name, mime_type, file_size = 1) => ({ document: { file_name, mime_type, file_size } });
  for (const n of ['a.JPG', 'a.heic', 'a.CR3', 'a.docx', 'a.pdf', 'a.mov', 'a.mp3', 'a.svg']) assert.ok(offerable(d(n)), n);
  for (const n of ['a.txt', 'a.xml', 'a.zip', 'a.ts', 'a_clean.mp4']) assert.ok(!offerable(d(n)), n);
  assert.ok(offerable(d(undefined, 'video/mp4')));
  assert.ok(offerable({ video: { mime_type: 'video/mp4' } }));
  assert.ok(!offerable(d('a.mp4', 'video/mp4', 3e9)), 'over the Bot API limit');
  assert.ok(!offerable({ animation: { file_name: 'a.mp4' } }));
});

test('metadata is escaped: a tag value cannot inject markup or overflow Telegram', () => {
  assert.equal(esc('<b>&'), '&lt;b&gt;&amp;');
  const t = metaText('T', ['author'], { author: [{ value: '<script>' }, { value: 'x (image1.jpg)' }, { value: 'x' }] }, (c) => c, 'yes');
  assert.equal(t, 'T\n\n<b>author</b>\n&lt;script&gt;\nx');
  const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`c${i}`, Array.from({ length: 5 }, (_, j) => ({ value: `${j}`.repeat(200) + '<'.repeat(80) }))]));
  assert.ok(metaText('T', Object.keys(many), many, (c) => c, 'yes').length <= 3900);
});
