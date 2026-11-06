// A scripted Telegram for tests: speaks the Bot API, keeps what the bot did, can rate-limit, fail and migrate like the real one.
import { createServer } from 'node:http';
import { copyFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';

const SENDS = { sendDocument: 'document', sendVideo: 'video', sendAudio: 'audio', sendAnimation: 'animation', sendVoice: 'voice', sendVideoNote: 'video_note' };
const local = (uri) => decodeURIComponent(uri.replace(/^file:\/\//, '')); // what the real Bot API does with a path

export class FakeTelegram {
  calls = []; sent = []; queue = []; downloaded = []; ids = 1_000_000; update = 1;
  kicked = new Set(); migrated = new Map(); rate = { limit: Infinity, perMs: 1000 }; times = new Map(); flaky = 0; latency = 0;
  constructor(tmp, fixture) { this.tmp = tmp; this.fixture = fixture; }

  async listen() {
    this.srv = createServer((req, res) => {
      let body = '';
      req.on('data', (d) => { body += d; }).on('end', async () => {
        const method = req.url.split('/').at(-1), p = JSON.parse(body || '{}');
        if (method === 'getUpdates') {
          if (this.stallPolls) return; // a Bot API that accepted the call and went silent
          await new Promise((s) => setTimeout(s, 5));
          this.queue = this.queue.filter((u) => u.update_id >= p.offset); // an update stays until the next poll confirms it: a crash repeats it
          return res.end(JSON.stringify({ ok: true, result: this.queue.slice(0, 100) }));
        }
        if (this.flaky && Math.random() < this.flaky && method !== 'getMe') return method in SENDS ? res.end(JSON.stringify({ ok: false, error_code: 502, description: 'Bad Gateway' })) : req.socket.destroy();
        try { res.end(JSON.stringify({ ok: true, result: await this.answer(method, p) })); }
        catch (e) { res.end(JSON.stringify({ ok: false, error_code: e.code ?? 400, description: e.message, parameters: e.parameters })); }
      });
    });
    await new Promise((s) => this.srv.listen(0, '127.0.0.1', s));
    return `http://127.0.0.1:${this.srv.address().port}`;
  }
  close() { this.srv.closeAllConnections(); this.srv.close(); }

  fail(code, message, parameters) { throw Object.assign(new Error(message), { code, parameters }); }
  gate(chat) {
    if (this.kicked.has(chat)) this.fail(403, 'Forbidden: bot was kicked from the supergroup chat');
    if (this.migrated.has(chat)) this.fail(400, 'Bad Request: group chat was upgraded to a supergroup chat', { migrate_to_chat_id: this.migrated.get(chat) });
    const t = (this.times.get(chat) ?? []).filter((x) => Date.now() - x < this.rate.perMs);
    if (t.length >= this.rate.limit) { this.limited = (this.limited ?? 0) + 1; this.fail(429, 'Too Many Requests: retry after 1', { retry_after: 1 }); }
    t.push(Date.now()); this.times.set(chat, t);
  }
  async answer(method, p) {
    const call = { method, ...p, at: Date.now() };
    this.calls.push(call);
    if (method === 'getMe') return { username: 'unmeta_bot' };
    if (method === 'sendMessage') { this.gate(p.chat_id); return { message_id: ++this.ids }; }
    if (method === 'getFile') {
      if (this.latency) await new Promise((s) => setTimeout(s, this.latency));
      await mkdir(join(this.tmp, 'cache/documents'), { recursive: true });
      const path = join(this.tmp, 'cache/documents', `file_${++this.ids}`);
      const src = this.fixture(p.file_id);
      if (!src) this.fail(400, 'Bad Request: wrong file_id');
      await copyFile(src, path);
      this.downloaded.push({ file_id: p.file_id, path });
      return { file_path: path };
    }
    if (method in SENDS) {
      this.gate(p.chat_id);
      const path = local(p[SENDS[method]]);
      if (!existsSync(path)) this.fail(400, "Bad Request: can't get stat about the file");
      if ((statSync(dirname(path)).mode & 0o005) !== 0o005) this.fail(400, "Bad Request: can't get stat about the file"); // it runs as another user
      const thumb = p.thumbnail ? local(p.thumbnail) : null;
      if (thumb && (!existsSync(thumb) || (await stat(thumb)).size > 200_000)) this.fail(400, 'Bad Request: bad thumbnail');
      const copy = join(this.tmp, `out-${++this.ids}`);
      await copyFile(path, copy);
      this.sent.push({ at: Date.now(), method, chat: p.chat_id, reply: p.reply_parameters?.message_id, thread: p.message_thread_id, name: path.split('/').at(-1), copy, thumb: !!thumb, caption: p.caption, supports_streaming: p.supports_streaming, duration: p.duration });
      return { message_id: ++this.ids };
    }
    if (method === 'editMessageText' || method === 'deleteMessage') { if (this.kicked.has(p.chat_id)) this.fail(403, 'Forbidden'); }
    return true;
  }
  send(u) { this.queue.push({ update_id: this.update++, ...u }); }
  of(m) { return this.calls.filter((c) => c.method === m); }
}

export async function until(fn, what = '', ms = 30_000) {
  const end = Date.now() + ms;
  for (;;) {
    const r = await fn();
    if (r) return r;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what || fn}`);
    await new Promise((s) => setTimeout(s, 15));
  }
}
