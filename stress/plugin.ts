// Stress-test server side (dev only). Serves real files read-only from their original place,
// receives cleaned output into ONE folder (~/Downloads/unmeta-stress), and checks it with native tools:
// leaks (deep text search incl. zip + zlib streams), decodability, lossless pixels / streams, PDF pages, Office text.
import type { Plugin } from 'vite';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, unlinkSync, appendFileSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { inflateSync, inflateRawSync } from 'node:zlib';
import { unzipSync, strFromU8 } from 'fflate';
import { PDFDocument, PDFRawStream, PDFArray } from 'pdf-lib';

export const OUT = join(homedir(), 'Downloads', 'unmeta-stress');
const KEEP_BYTES = 300 * 2 ** 20;   // keep cleaned copies up to this size…
const BUDGET = 15 * 2 ** 30;        // …and this much in total
let kept = 0;

interface Entry { i: number; ext: string; size: number; path: string; why?: string }
const manifests = new Map<string, Entry[]>();
const list = (set: string) => {
  if (!manifests.has(set)) manifests.set(set, JSON.parse(readFileSync(join(OUT, `manifest-${set}.json`), 'utf8')));
  return manifests.get(set)!;
};
const meta = new Map<string, Record<string, unknown>>();

// ---------- checks ----------
// async: a long ffmpeg hash must not freeze the server for the other devices (that caused "Failed to fetch")
const run = promisify(execFile);
const sh = async (cmd: string, args: string[], timeout = 900_000) => (await run(cmd, args, { timeout, maxBuffer: 256 * 2 ** 20, encoding: 'latin1' })).stdout;
const md5 = (b: Buffer | Uint8Array) => createHash('md5').update(b).digest('hex');
const IMG = /^(jpe?g|png|gif|webp|avif|bmp|tiff?)$/, SIPS = /^(heic|heif|dng|cr2|cr3|nef|arw|raf|orf|rw2|pef|srw)$/;
const AV = /^(mp4|mov|m4v|3gp|mkv|webm|avi|wmv|mts|m2ts|mp3|m4a|aac|wav|flac|ogg|opus|aiff?)$/;

async function pixels(path: string, ext: string, tmp: string): Promise<string> {
  if (SIPS.test(ext)) {
    const png = `${tmp}.png`;
    await sh('sips', ['-s', 'format', 'png', path, '--out', png]);
    if (!existsSync(png)) throw new Error('sips: no image');
    const h = (await sh('ffmpeg', ['-v', 'error', '-i', png, '-f', 'md5', '-'])).trim(); unlinkSync(png); return h;
  }
  return (await sh('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:v:0', '-frames:v', '1', '-f', 'md5', '-'])).trim();
}
// 0:V = video that isn't an attached cover picture (covers are cleaned on purpose, so their bytes change)
const streams = async (path: string) => (await sh('ffmpeg', ['-v', 'error', '-i', path, '-map', '0:V?', '-map', '0:a?', '-c', 'copy', '-f', 'streamhash', '-hash', 'md5', '-'], 900_000))
  .split('\n').filter(Boolean).map((l) => l.split(',').slice(1).join(',')).join('|');

async function pdfPages(path: string): Promise<string> {
  const doc = await PDFDocument.load(readFileSync(path), { ignoreEncryption: true, updateMetadata: false });
  return doc.getPages().map((p) => {
    const c = p.node.Contents(); const arr = c instanceof PDFArray ? c.asArray() : c ? [c] : [];
    return md5(Buffer.concat(arr.map((r) => { const s = doc.context.lookup(r); return s instanceof PDFRawStream ? Buffer.from(s.contents) : Buffer.alloc(0); })));
  }).join(',');
}
function officeText(path: string): string {
  const z = unzipSync(readFileSync(path));
  return Object.keys(z).filter((k) => /^(word\/document|word\/(header|footer)\d*|xl\/sharedStrings|ppt\/slides\/slide\d+|content)\.xml$/.test(k)).sort()
    .map((k) => strFromU8(z[k]).replace(/<[^>]+>/g, '')).join('\n');
}

/** All readable text in a file: raw bytes + zip entries + zlib/deflate streams (small files only). */
function deepText(buf: Buffer): string {
  const parts = [buf.toString('latin1')];
  if (buf.length > 64 * 2 ** 20) return parts[0];
  if (buf[0] === 0x50 && buf[1] === 0x4b) { try { for (const v of Object.values(unzipSync(buf))) parts.push(deepText(Buffer.from(v))); } catch { /* not a full zip */ } }
  for (let i = buf.indexOf(0x78); i >= 0 && i < buf.length - 2; i = buf.indexOf(0x78, i + 1)) {
    if (![0x01, 0x5e, 0x9c, 0xda].includes(buf[i + 1])) continue;
    try { parts.push(inflateSync(buf.subarray(i)).toString('latin1')); } catch { try { parts.push(inflateRawSync(buf.subarray(i + 2)).toString('latin1')); } catch { /* not zlib */ } }
  }
  return parts.join('\0');
}
// Values that are part of the document's own text (a CV headline, the style named "Normal") aren't metadata.
function contentText(e: Entry): string {
  try {
    if (/^(docx|xlsx|pptx|odt|ods|odp)$/.test(e.ext)) {
      const z = unzipSync(readFileSync(e.path));
      return Object.keys(z).filter((k) => /\.xml$/.test(k) && !/^(docProps\/|meta\.xml$|word\/(comments|people)|.*customXml)/.test(k)).map((k) => strFromU8(z[k])).join('\n');
    }
    if (e.ext === 'svg') return readFileSync(e.path, 'utf8').replace(/<metadata[\s\S]*?<\/metadata>|<!--[\s\S]*?-->/g, '');
  } catch { /* not a zip */ }
  return '';
}
async function leaks(path: string, values: string[], e?: Entry): Promise<string[]> {
  if (e) { const content = contentText(e); if (content) values = values.filter((v) => !content.includes(v)); }
  if (!values.length) return [];
  const size = statSync(path).size;
  if (size <= 256 * 2 ** 20) { const txt = deepText(readFileSync(path)); return values.filter((v) => txt.includes(v)); }
  // huge outputs: metadata lives in container headers, scan the first and last 32 MB raw
  const head = await sh('head', ['-c', String(32 * 2 ** 20), path]), tail = await sh('tail', ['-c', String(32 * 2 ** 20), path]);
  return values.filter((v) => head.includes(v) || tail.includes(v));
}

async function check(e0: Entry, out: string, m: Record<string, unknown>, set: string) {
  const r: Record<string, unknown> = {};
  // judge by what the file really is (a JPEG named .pdf gets image checks)
  const KIND_EXT: Record<string, string> = { image: 'jpg', raw: e0.ext, av: AV.test(e0.ext) ? e0.ext : 'mp4', pdf: 'pdf', office: e0.ext, svg: 'svg', text: 'txt' };
  const e = { ...e0, ext: m.kind && (m.kind !== 'image' || !IMG.test(e0.ext) && !SIPS.test(e0.ext)) ? (KIND_EXT[m.kind as string] ?? e0.ext) : e0.ext };
  // fuzz files carry known markers, including in places ExifTool can't see (cover art EXIF, subtitles, attachments)
  if (set === 'fuzz') m.leakValues = [...((m.leakValues as string[]) ?? []), 'FUZZSECRET', 'FuzzCam', '55.7558'];
  const tmp = join(OUT, 'tmp', `x${e.i}`);
  try { r.leaks = await leaks(out, (m.leakValues as string[]) ?? [], e); } catch (x) { r.leakErr = String(x).slice(0, 200); }
  try {
    // a broken original isn't our fault: only then compare against it
    if (IMG.test(e.ext) || SIPS.test(e.ext)) {
      let a = ''; try { a = await pixels(e.path, e.ext, tmp + 'a'); } catch { r.origBroken = true; }
      let b = ''; try { b = await pixels(out, e.ext, tmp + 'b'); r.decodes = true; } catch (x) { r.decodes = r.origBroken ? 'n/a' : false; if (!r.origBroken) throw x; }
      if (a && b) r.lossless = a === b;
    } else if (AV.test(e.ext)) {
      let a = ''; try { a = await streams(e.path); } catch { r.origBroken = true; }
      const b = await streams(out); r.decodes = !!b; if (a) { r.lossless = a === b; if (a !== b) r.streamsDiff = [a.slice(0, 300), b.slice(0, 300)]; }
    }
    else if (e.ext === 'pdf') { const a = await pdfPages(e.path), b = await pdfPages(out); r.lossless = a === b; r.decodes = true; }
    else if (/^(docx|xlsx|pptx|odt|ods|odp)$/.test(e.ext)) { r.lossless = officeText(e.path) === officeText(out); r.decodes = true; }
    else if (/^(txt|md|csv|json)$/.test(e.ext)) { r.lossless = md5(readFileSync(e.path)) === md5(readFileSync(out)); r.decodes = true; }
    else if (e.ext === 'svg') { const s = readFileSync(out, 'utf8'); r.decodes = /<svg[\s>]/i.test(s); }
  } catch (x) { r.decodes = false; r.checkErr = String((x as { stderr?: Buffer }).stderr ?? x).slice(0, 300); }
  return r;
}

// ---------- plugin ----------
export function stress(): Plugin {
  mkdirSync(join(OUT, 'tmp'), { recursive: true });
  return {
    name: 'unmeta-stress',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '', 'http://x');
        if (!url.pathname.startsWith('/stress/api/')) return next();
        const [, , , op, set, idx] = url.pathname.split('/');
        const run = url.searchParams.get('run') ?? 'run';
        try {
          if (op === 'list') { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify(list(set).map(({ i, ext, size, path, why }) => ({ i, ext, size, why, name: basename(path) })))); }
          const e = list(set)[Number(idx)];
          if (op === 'file') { res.setHeader('content-length', String(statSync(e.path).size)); return createReadStream(e.path).pipe(res); }
          const body = async () => { const c: Buffer[] = []; for await (const x of req) c.push(x as Buffer); return Buffer.concat(c).toString(); };
          const log = (o: object) => { mkdirSync(join(OUT, run), { recursive: true }); appendFileSync(join(OUT, run, `${set}.jsonl`), JSON.stringify({ i: e.i, ext: e.ext, size: e.size, path: e.path, ...o }) + '\n'); };
          if (op === 'meta') { meta.set(`${run}/${set}/${idx}`, JSON.parse(await body())); return res.end('ok'); }
          if (op === 'fail') { log(JSON.parse(await body())); return res.end('ok'); }
          if (op === 'output') {
            const dir = join(OUT, run, 'out'); mkdirSync(dir, { recursive: true });
            const m = meta.get(`${run}/${set}/${idx}`) ?? {};
            const out = join(dir, `${String(e.i).padStart(4, '0')}_${(m.cleanName as string) ?? basename(e.path)}`);
            await new Promise((ok, bad) => req.pipe(createWriteStream(out)).on('finish', ok).on('error', bad));
            const c = await check(e, out, m, set);
            const sz = statSync(out).size;
            if (sz <= KEEP_BYTES && kept + sz <= BUDGET) kept += sz; else unlinkSync(out);
            log({ ...m, leakValues: undefined, outSize: sz, ...c });
            res.setHeader('content-type', 'application/json');
            return res.end(JSON.stringify(c));
          }
          if (op === 'summary') { writeFileSync(join(OUT, run, `${set}.done`), await body()); return res.end('ok'); }
        } catch (x) { res.statusCode = 500; return res.end(String(x)); }
        next();
      });
    },
  };
}
