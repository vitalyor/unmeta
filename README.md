# Unmeta

Removes hidden data — location, phone model and serial numbers, author, dates, edit history — from photos, videos,
audio and documents. **Right in the browser: files never leave your device.**

- Photos (JPEG, HEIC, PNG, WebP, AVIF, GIF, TIFF, PSD, RAW), video and audio (MP4, MOV, MKV, WebM, AVI, MP3, FLAC, …),
  PDF, Word/Excel/PowerPoint, OpenDocument, SVG.
- Lossless: image pixels and audio/video streams are copied bit-for-bit.
- Every cleaned file is re-read and checked; anything that couldn't be removed is reported, never hidden.

Built with Svelte, ExifTool (in WebAssembly via zeroperl), ffmpeg.wasm and pdf-lib.

## Develop

```bash
npm ci
npm run dev     # http://localhost:5173
npm test        # engine tests in Chromium and WebKit
node test/e2e.mjs http://localhost:4173/unmeta/ chromium   # end-to-end, after `BASE=/unmeta/ npm run build && npx vite preview --base /unmeta/`
```

Requires Node ≥ 26.12.1.

## License

AGPL-3.0. Bundled: ExifTool (Perl Artistic / GPL), ffmpeg.wasm (GPL-2.0+), Lucide icons (ISC), Onest & Unbounded fonts (OFL).
