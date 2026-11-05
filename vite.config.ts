import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs in Node during browser tests: does the cleaned file still decode with native tools?
function decodes(_ctx: unknown, name: string, b64: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'unmeta-'));
  const path = join(dir, name);
  writeFileSync(path, Buffer.from(b64, 'base64'));
  try {
    if (/\.(heic|dng|cr2|cr3|nef|arw|raf|orf|rw2|pef|srw)$/i.test(name)) {
      // full decode through macOS RAW/HEIC support, not just a header read
      const png = join(dir, 'decoded.png');
      execFileSync('sips', ['-s', 'format', 'png', path, '--out', png], { stdio: 'pipe' });
      if (!existsSync(png) || statSync(png).size < 1000) throw new Error('sips produced no image');
    }
    else if (/\.(pdf|docx|odt|svg|txt)$/i.test(name)) execFileSync('file', [path], { stdio: 'pipe' }); // structure checked elsewhere
    else execFileSync('ffmpeg', ['-v', 'error', '-xerror', '-i', path, '-f', 'null', '-'], { stdio: 'pipe' });
    return 'ok';
  } catch (e) {
    return `broken: ${String((e as { stderr?: Buffer }).stderr ?? e).slice(0, 300)}`;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

export default defineConfig({
  plugins: [svelte()],
  // Engines resolve their .wasm via import.meta.url / ?url; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@6over3/zeroperl-ts', '@ffmpeg/ffmpeg', '@ffmpeg/util'] },
  worker: { format: 'es' },
  test: {
    include: ['test/**/*.test.ts'],
    testTimeout: 60_000,
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      commands: { decodes },
      instances: [{ browser: 'chromium' }, { browser: 'webkit' }],
    },
  },
});
