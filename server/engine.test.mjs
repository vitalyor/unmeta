// Server engine on the shared fixtures: node --test server/ (after npm run build:server)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXPECT, CYRILLIC } from '../test/expect.ts';

process.env.WORK_DIR ??= fileURLToPath(new URL('../test/.tmp/server-work', import.meta.url));
const { clean, inspect, kindOf, PRESETS, fileFromPath, DiskFile } = await import('./dist/engine.mjs');
const fx = (n) => fileURLToPath(new URL(`../test/fixtures/${n}`, import.meta.url));
const done = (r) => r.blob instanceof DiskFile ? rm(dirname(r.blob.path), { recursive: true, force: true }) : null;

for (const [name, cats] of Object.entries(EXPECT)) {
  test(`${name}: finds ${cats.join(', ')}; Maximum leaves nothing`, async () => {
    const f = await fileFromPath(fx(name), name);
    const before = await inspect(f);
    for (const c of cats) assert.ok(before.found[c], `${c} not found`);
    const r = await clean(f, PRESETS.max); // throws if anything removable survived
    assert.deepEqual(Object.keys(r.after.found), []);
    if (r.blob instanceof DiskFile) execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', r.blob.path, '-f', 'null', '-']); // still plays
    await done(r);
  });
}

for (const [name, author] of Object.entries(CYRILLIC)) {
  test(`${name}: author shown as written, then removed`, async () => {
    const f = await fileFromPath(fx(name), name);
    assert.ok((await inspect(f)).found.author?.some((t) => t.value === author));
    const r = await clean(f, PRESETS.max);
    assert.deepEqual(r.after.found, {});
    assert.ok(!Buffer.from(await r.blob.arrayBuffer()).includes(Buffer.from(author)));
    await done(r);
  });
}

test('video: Balanced keeps the dates', async () => {
  const r = await clean(await fileFromPath(fx('video.mov'), 'video.mov'), PRESETS.balanced);
  assert.ok(r.after.found.dates);
  assert.ok(!r.after.found.location);
  await done(r);
});

test('in-memory input works too (copied to a temp file for ffmpeg)', async () => {
  const f = await fileFromPath(fx('video.mp4'), 'video.mp4');
  const r = await clean(new File([f], 'video.mp4'), PRESETS.max);
  assert.deepEqual(Object.keys(r.after.found), []);
  await done(r);
});

test('text and unknown formats', async () => {
  assert.equal(await kindOf(await fileFromPath(fx('notes.txt'), 'notes.txt')), 'text');
  await assert.rejects(clean(await fileFromPath(fx('scene.blend'), 'scene.blend'), PRESETS.max), /unsupported/);
});
