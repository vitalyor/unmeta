// Server build: the bot + the site's engine as one Node bundle (server/dist), ffmpeg.wasm swapped for native ffmpeg.
import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { copyFileSync } from 'node:fs';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  plugins: [{
    name: 'native-av',
    enforce: 'pre',
    resolveId(src, importer) {
      if (src === './av' && importer?.endsWith('/src/engine/index.ts')) return here('./server/av.ts');
    },
    writeBundle() {
      copyFileSync(here('./node_modules/@6over3/zeroperl-ts/dist/esm/zeroperl.wasm'), here('./server/dist/zeroperl.wasm'));
    },
  }],
  publicDir: false,
  ssr: { noExternal: true },
  build: {
    ssr: true,
    target: 'node26',
    outDir: 'server/dist',
    emptyOutDir: true,
    rollupOptions: {
      input: { bot: here('./server/bot.ts'), worker: here('./server/worker.ts'), engine: here('./server/engine.ts') },
      output: { format: 'es', entryFileNames: '[name].mjs', chunkFileNames: '[name].mjs' }, // one folder: the wasm sits next to every chunk
    },
  },
});
