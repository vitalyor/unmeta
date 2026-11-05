import { describe, it, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { unzipSync, unzlibSync } from 'fflate';
import { inspect, clean, cleanName, PRESETS, type Category } from '../src/engine';
import { classify } from '../src/engine/categories';
import { EXPECT, CYRILLIC } from './expect';

declare module 'vitest/browser' {
  interface BrowserCommands { decodes: (name: string, b64: string) => Promise<string> }
}

const load = async (n: string) => new File([await (await fetch(`/test/fixtures/${n}`)).blob()], n);
const SECRETS = ['UNMETASECRET', 'Ivan Petrov', 'iPhone 15 Pro', 'SecretEditor', 'Microsoft Word', 'SecretPDF', '2025:05:03', '2025-05-03'];

/** All readable text in a file: raw bytes, every zip entry, every zlib/Flate stream (PDF). */
async function deepText(blob: Blob): Promise<string> {
  const b = new Uint8Array(await blob.arrayBuffer());
  const parts = [latin1(b)];
  if (b[0] === 0x50 && b[1] === 0x4b) for (const [, v] of Object.entries(unzipSync(b))) parts.push(...(await deepText(new Blob([v]))).split('\0'));
  for (let i = 0; i < b.length - 2; i++) {
    if (b[i] === 0x78 && (b[i + 1] === 0x9c || b[i + 1] === 0xda || b[i + 1] === 0x01)) {
      try { parts.push(latin1(unzlibSync(b.subarray(i)))); } catch { /* not a zlib stream */ }
    }
  }
  return parts.join('\0');
}
const latin1 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 65536) s += String.fromCharCode(...b.subarray(i, i + 65536)); return s; };
const b64 = async (blob: Blob) => { const s = latin1(new Uint8Array(await blob.arrayBuffer())); return btoa(s); };


describe('maximum preset removes every planted secret and keeps files valid', () => {
  for (const [name, cats] of Object.entries(EXPECT)) {
    it(name, async () => {
      const file = await load(name);
      const before = await inspect(file);
      for (const c of cats) expect(before.found[c], `${name}: ${c} detected`).toBeTruthy();

      const t = performance.now();
      const r = await clean(file, PRESETS.max);
      const ms = performance.now() - t;
      expect(r.after.found).toEqual({});
      const text = await deepText(r.blob);
      for (const s of SECRETS) expect(text.includes(s), `${name}: "${s}" left somewhere`).toBe(false);
      expect(await commands.decodes(name, await b64(r.blob))).toBe('ok');
      if (/^photo(-big)?\.(jpg|png|tif|heic)$/.test(name)) expect(r.after.tags.find((t) => t.name === 'Orientation')?.value).toBe('Rotate 90 CW');
      if (/^video\.(mp4|mov)$/.test(name)) expect(r.after.tags.find((t) => t.name === 'Rotation')?.value).toBe('90');
      console.log(`${name}: ${ms.toFixed(0)} ms, ${file.size} → ${r.blob.size} B`);
    });
  }
});

describe('presets keep what they promise', () => {
  it('balanced keeps dates and descriptions in a photo, removes the rest', async () => {
    const r = await clean(await load('photo.jpg'), PRESETS.balanced);
    expect(Object.keys(r.after.found).sort()).toEqual(['dates', 'descriptions']);
  });
  it('private-only keeps author/software/thumbnails/dates/descriptions, removes location and device', async () => {
    const r = await clean(await load('photo.jpg'), PRESETS.private);
    expect(r.after.found.location).toBeUndefined();
    expect(r.after.found.device).toBeUndefined();
    expect(r.after.found.author).toBeTruthy();
    expect(r.after.found.thumbnails).toBeTruthy();
  });
  it('keeping only location in a docx still removes the author', async () => {
    const r = await clean(await load('doc.docx'), ['location']);
    expect((await deepText(r.blob)).includes('Ivan Petrov')).toBe(false);
  });
});

describe('other kinds', () => {
  it('svg: editor metadata, comments, file paths removed', async () => {
    const r = await clean(await load('drawing.svg'), PRESETS.max);
    const s = await r.blob.text();
    expect(s).not.toMatch(/UNMETASECRET|Ivan|inkscape:|sodipodi:/);
    expect(s).toMatch(/<rect/);
  });
  it('text: nothing embedded, returned as is', async () => {
    const r = await clean(await load('notes.txt'), PRESETS.max);
    expect(await r.blob.text()).toBe('just some text\n');
    expect(r.before.found).toEqual({});
  });
  it('unknown format is refused, never "cleaned"', async () => {
    await expect(clean(await load('scene.blend'), PRESETS.max)).rejects.toThrow('unsupported');
  });
  it('names: the original name plus a suffix, never renamed', () => {
    expect(cleanName('IMG_2025.jpg')).toBe('IMG_2025_clean.jpg');
    expect(cleanName('Отпуск у мамы.final.MOV')).toBe('Отпуск у мамы.final_clean.MOV');
    expect(cleanName('README')).toBe('README_clean');
  });
});

describe('non-Latin text', () => {
  for (const [name, author] of Object.entries(CYRILLIC)) {
    it(`${name}: author shown as written, then removed`, async () => {
      const f = await load(name);
      const r = await inspect(f);
      expect(r.found.author?.map((t) => t.value)).toContain(author);
      const c = await clean(f, PRESETS.max);
      expect(c.after.found).toEqual({});
      expect(new TextDecoder().decode(await c.blob.arrayBuffer())).not.toContain(author);
    }, 60_000);
  }
});

describe('classify', () => {
  it('video timecode can be time of day: a date, unless zero', () => {
    const tc = (value: string) => classify({ group0: 'ffmpeg', group1: 'ffmpeg', group2: '', name: 'timecode', value });
    expect(tc('00:56:18:12')).toBe('dates');
    expect(tc('00:00:00:00')).toBeNull();
  });
});

describe('concurrency', () => {
  it('parallel requests never mix up answers (warm-up racing a real file)', async () => {
    const files = await Promise.all(['photo.jpg', 'notes.txt', 'photo.png', 'doc.pdf', 'photo.heic'].map(load));
    const reports = await Promise.all(files.map((f) => inspect(f)));
    expect(Object.keys(reports[0].found)).toContain('location');
    expect(Object.keys(reports[2].found)).toContain('location');
    expect(Object.keys(reports[3].found)).toContain('author');
    expect(Object.keys(reports[4].found)).toContain('location');
    const cleaned = await Promise.all([clean(files[0], PRESETS.max), clean(files[2], PRESETS.max), clean(files[4], PRESETS.max)]);
    for (const c of cleaned) expect(c.after.found).toEqual({});
  });
});
