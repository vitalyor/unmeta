// Stress-test server: `node node_modules/vite/bin/vite.js --config vite.stress.config.ts` → http://127.0.0.1:5180/stress/ (Android emulator: http://10.0.2.2:5180/stress/)
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { stress } from './stress/plugin';

export default defineConfig({
  plugins: [svelte(), stress()],
  optimizeDeps: { exclude: ['@6over3/zeroperl-ts', '@ffmpeg/ffmpeg', '@ffmpeg/util'], include: ['pdf-lib', 'fflate'] }, // no mid-run reloads
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5180, strictPort: true }, // never on the LAN: it serves files from this Mac
});
