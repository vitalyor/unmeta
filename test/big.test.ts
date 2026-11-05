// Big-file check, opt-in: node test/make-big.mjs && npx vitest run test/big.test.ts
import { it, expect } from 'vitest';
import { clean, PRESETS } from '../src/engine';

it('cleans a ~270 MB phone video fast and without copying it into wasm memory', async () => {
  const res = await fetch('/test/.big/big.mp4');
  if (!res.ok) return console.log('skip: run node test/make-big.mjs first');
  const file = new File([await res.blob()], 'big.mp4', { type: 'video/mp4' });
  const t = performance.now();
  const r = await clean(file, PRESETS.max);
  const s = (performance.now() - t) / 1000;
  console.log(`big.mp4 ${(file.size / 2 ** 20).toFixed(0)} MB: ${s.toFixed(1)} s total (read + clean + verify)`);
  expect(r.after.found).toEqual({});
  expect(r.blob.size).toBeGreaterThan(file.size * 0.99);
  expect(s).toBeLessThan(20);
}, 300_000);
