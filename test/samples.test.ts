// Real-world public samples, opt-in: bash test/fetch-samples.sh && npx vitest run test/samples.test.ts
import { describe, it, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { inspect, clean, PRESETS, type Category } from '../src/engine';

const load = async (n: string) => {
  const r = await fetch(`/test/samples/${n}`);
  return r.ok ? new File([await r.blob()], n) : null;
};
const b64 = async (blob: Blob) => {
  const b = new Uint8Array(await blob.arrayBuffer());
  let s = ''; for (let i = 0; i < b.length; i += 65536) s += String.fromCharCode(...b.subarray(i, i + 65536));
  return btoa(s);
};
const cats = (found: object) => Object.keys(found).sort().join(',') || '-';

const RAW = ['iphone12pro.dng', 'pixel8pro.dng', 'canon-r5.cr3', 'sony-a7m5.arw', 'nikon-z6iii.nef', 'fuji-xm5.raf', 'om5ii.orf', 'panasonic-g9.rw2'];

describe('RAW from real cameras: private data removed, file still opens', () => {
  for (const name of RAW) {
    it(name, async () => {
      const file = await load(name);
      if (!file) return console.log(`skip ${name}: run test/fetch-samples.sh`);
      const before = await inspect(file);
      const t = performance.now();
      const r = await clean(file, PRESETS.max, 'photo_01');
      console.log(`${name}: ${(file.size / 2 ** 20).toFixed(1)} MB, ${(performance.now() - t).toFixed(0)} ms | before: ${cats(before.found)} | after: ${cats(r.after.found)} | ${r.notes.join(' ')}`);
      // the dangerous ones must be gone, no excuses
      for (const c of ['location', 'author', 'descriptions'] as Category[]) expect(r.after.found[c], `${name}: ${c}`).toBeUndefined();
      const serial = r.after.tags.filter((t) => /SerialNumber/i.test(t.name) && !/^[0\s]*$/.test(t.value));
      if (serial.length) expect(r.notes.join(' '), `${name}: serial left but not reported`).toContain('serial');
      // anything else that survived (dates/software locked inside MakerNotes) must be reported, never hidden
      for (const c of ['dates', 'software'] as Category[]) {
        if (r.after.found[c]) expect(r.notes.join(' '), `${name}: ${c} left but not reported`).toContain(c);
      }
      // macOS can't decode some brand-new cameras at all; then only require "no worse than the original"
      const orig = await commands.decodes(name, await b64(file));
      if (orig === 'ok') expect(await commands.decodes(name, await b64(r.blob))).toBe('ok');
      else console.log(`${name}: original doesn't decode on this machine either — decode check skipped`);
    }, 120_000);
  }
});

describe('C2PA (content credentials)', () => {
  it('jpeg: detected, removed by max, kept by balanced', async () => {
    const file = await load('c2pa.jpg');
    if (!file) return;
    const before = await inspect(file);
    expect(before.found.c2pa, 'c2pa detected').toBeTruthy();
    const max = await clean(file, PRESETS.max, 'x');
    expect(max.after.found.c2pa).toBeUndefined();
    const bal = await clean(file, PRESETS.balanced, 'x');
    console.log(`c2pa.jpg balanced after: ${cats(bal.after.found)}`);
    expect(bal.after.found.c2pa, 'balanced keeps C2PA').toBeTruthy();
  });
  it('pdf: content credentials removed by max', async () => {
    const file = await load('c2pa.pdf');
    if (!file) return;
    const before = await inspect(file);
    const r = await clean(file, PRESETS.max, 'x');
    const raw = new TextDecoder('latin1').decode(new Uint8Array(await r.blob.arrayBuffer()));
    console.log(`c2pa.pdf before: ${cats(before.found)} after: ${cats(r.after.found)} jumb-in-file: ${/jumb|c2pa/i.test(raw)}`);
    expect(r.after.found.c2pa).toBeUndefined();
    expect(/c2pa\.(claim|signature|assertions)/i.test(raw)).toBe(false);
  });
  it('mp4: content credentials removed', async () => {
    const file = await load('c2pa.mp4');
    if (!file) return;
    const before = await inspect(file);
    const r = await clean(file, PRESETS.max, 'x');
    console.log(`c2pa.mp4 before: ${cats(before.found)} after: ${cats(r.after.found)}`);
    expect(r.after.found.c2pa).toBeUndefined();
    expect(await commands.decodes('c2pa.mp4', await b64(r.blob))).toBe('ok');
  }, 120_000);
});
