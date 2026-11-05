// The built bot against a fake Bot API: real engine, scripted Telegram. node --test server/bot.test.mjs (after build:server)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc, fileUri, offerable } from './chat.ts';

const fx = (n) => fileURLToPath(new URL(`../test/fixtures/${n}`, import.meta.url));
const dist = fileURLToPath(new URL('./dist/bot.mjs', import.meta.url));
const GROUP = { id: -100, type: 'supergroup' }, DM = { id: 7, type: 'private' }, USER = { id: 7, language_code: 'ru' };
let tmp, srv, bot, inputs = [], calls = [], queue = [], ids = 1000, update = 1;

const answer = (method, b) => {
  const call = { method, ...b };
  calls.push(call);
  if (method === 'getMe') return { username: 'unmeta_bot' };
  if (method === 'sendMessage') return { message_id: ++ids };
  if (method === 'getFile') { const p = join(tmp, `in-${++ids}-${b.file_id}`); inputs.push(p); return copyFile(fx(b.file_id), p).then(() => ({ file_path: p })); }
  if (method === 'sendDocument') {
    const p = decodeURIComponent(b.document.replace('file://', '')); // what the real Bot API does with the path
    if (!existsSync(p)) throw new Error('file to send does not exist');
    if ((statSync(dirname(p)).mode & 0o005) !== 0o005) throw new Error("can't get stat about the file"); // it runs as another user
    call.path = p;
    return { message_id: ++ids };
  }
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
  bot = spawn(process.execPath, [dist], { stdio: 'inherit', env: { ...process.env, BOT_TOKEN: 't', BOT_API: `http://127.0.0.1:${srv.address().port}`, WORK_DIR: join(tmp, 'work') } });
  await until(() => of('setMyCommands').length === 2);
});
after(async () => { bot.kill(); srv.closeAllConnections(); srv.close(); await rm(tmp, { recursive: true, force: true }); });

test('group: a supported file gets the clean button and nothing is downloaded', async () => {
  calls = [];
  const m = doc('photo-cyrillic.jpg');
  send({ message: m });
  const offer = await until(() => of('sendMessage')[0]);
  assert.equal(offer.reply_parameters.message_id, m.message_id);
  assert.deepEqual(offer.reply_markup.inline_keyboard.flat().map((b) => b.callback_data), ['file:clean']);
  assert.match(offer.text, /photo-cyrillic\.jpg/);
  await settle();
  assert.equal(of('getFile').length, 0);
});

test('group: the bot stays silent on everything else', async () => {
  calls = [];
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/mode' } });
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

test('group: "Remove metadata" replies to the file with the clean copy and leaves nothing behind', async () => {
  calls = [];
  const m = doc('video-cyrillic.mp4'), statusId = ++ids;
  press('file:clean', m, GROUP, statusId);
  const sent = await until(() => of('sendDocument')[0]);
  assert.equal(basename(sent.path), 'video-cyrillic_clean.mp4');
  assert.equal(sent.reply_parameters.message_id, m.message_id);
  assert.match(sent.caption, /Удалено:.*Автор/);
  await until(() => of('deleteMessage').some((c) => c.message_id === statusId));
  await settle();
  assert.deepEqual((await readdir(join(tmp, 'work'))).filter((n) => n.startsWith('job-')), []);
  assert.ok(inputs.every((p) => !existsSync(p)), 'the downloaded original is deleted');
});

test('a Cyrillic name with spaces and a percent sign is sent intact', async () => {
  calls = [];
  const m = doc('photo-cyrillic.jpg');
  m.document.file_name = 'Отпуск 100% #1.jpg';
  press('file:clean', m);
  assert.equal(basename((await until(() => of('sendDocument')[0])).path), 'Отпуск 100% #1_clean.jpg');
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

test('group: /clean works as a reply; /meta and old view buttons do nothing', async () => {
  calls = [];
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/meta', reply_to_message: doc('doc.pdf') } });
  press('file:meta', doc('doc.pdf'));
  await settle(); await settle();
  assert.equal(of('getFile').length, 0);
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/clean', reply_to_message: doc('doc.pdf') } });
  assert.equal(basename((await until(() => of('sendDocument')[0])).path), 'doc_clean.pdf');
});

test('group: /clean without a file asks for one; a deleted file message is explained', async () => {
  calls = [];
  send({ message: { message_id: ++ids, chat: GROUP, from: USER, text: '/clean' } });
  await until(() => of('sendMessage').some((c) => /Ответьте \/clean/.test(c.text)));
  press('file:clean', undefined);
  await until(() => of('answerCallbackQuery').some((c) => /удалено/.test(c.text)));
});

test('private chat: complete silence', async () => {
  calls = [];
  send({ message: doc('photo-cyrillic.jpg', DM) });
  send({ message: { message_id: ++ids, chat: DM, from: USER, text: '/start' } });
  send({ message: { message_id: ++ids, chat: DM, from: USER, text: '/clean', reply_to_message: doc('photo.jpg', DM) } });
  send({ message: { message_id: ++ids, chat: DM, from: USER, text: 'привет' } });
  press('file:clean', doc('photo.jpg', DM), DM);
  await settle(); await settle();
  assert.deepEqual(calls.map((c) => c.method).filter((m) => m !== 'answerCallbackQuery'), []);
});

test('a failed job still cleans up and says so', async () => {
  calls = [];
  press('file:clean', doc('scene.blend'));
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

test('names are safe in chat text and in paths', () => {
  assert.equal(esc('<b>&'), '&lt;b&gt;&amp;');
  assert.equal(fileUri('/w/job-1/Отпуск 100%.jpg'), 'file:///w/job-1/%D0%9E%D1%82%D0%BF%D1%83%D1%81%D0%BA%20100%25.jpg');
});
