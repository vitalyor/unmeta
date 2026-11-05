// Engine worker: Perl/ExifTool (read everything, clean photos), PDF, Office, SVG.
// Audio/video cleaning runs through ffmpeg.wasm on the main thread (it has its own worker).
import './worker-shim';
import wasmURL from '@6over3/zeroperl-ts/zeroperl.wasm?url';
import { Perl } from './perl';
import { cleanPdf, pdfJpegs } from './pdf';
import { cleanOffice, readOffice } from './office';
import { cleanSvg } from './svg';
import { detect, type Kind } from './detect';
import type { Category, Tag } from './categories';

export type Req =
  | { id: number; op: 'read'; file: File; kind: Kind }
  | { id: number; op: 'clean'; file: File; kind: Kind; keep: Category[] }
  | { id: number; op: 'scrub'; file: File; tags: Tag[] };
export type Res = { id: number; tags?: Tag[]; bytes?: Uint8Array; error?: string };

const perl = Perl.create(() => fetch(wasmURL));
perl.catch(() => {}); // surfaced on first request

const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d);

const cleanImageBytes = async (name: string, bytes: Uint8Array, keep: Category[]) => {
  if (detect(name, bytes.subarray(0, 64)) !== 'image') return bytes;
  return (await perl).clean(name, bytes, isTiff(bytes) ? 'tiff' : 'image', keep);
};

/** Tags of embedded photos, labelled with where they were found. */
async function embeddedTags(images: [string, Uint8Array][]): Promise<Tag[]> {
  const p = await perl;
  const out: Tag[] = [];
  for (const [where, bytes] of images) {
    for (const t of (await p.read(where, bytes)).tags) out.push({ ...t, value: `${t.value} (${where})` });
  }
  return out;
}

async function read(file: File, kind: Kind): Promise<Tag[]> {
  const p = await perl;
  if (kind === 'office') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { tags, images } = readOffice(bytes);
    const zip = (await p.read(file.name, file)).tags.filter((t) => t.group0 === 'ZIP' && t.name === 'ZipModifyDate').slice(0, 1);
    return [...tags, ...zip, ...(await embeddedTags(images))];
  }
  const tags = (await p.read(file.name, file)).tags;
  if (kind === 'pdf') {
    const jpegs = await pdfJpegs(new Uint8Array(await file.arrayBuffer())).catch(() => []);
    tags.push(...(await embeddedTags(jpegs.map((b, i) => [`image${i + 1}.jpg`, b] as [string, Uint8Array]))));
  }
  return tags;
}

async function clean(file: File, kind: Kind, keep: Category[]): Promise<Uint8Array> {
  const p = await perl;
  switch (kind) {
    case 'image': return p.clean(file.name, file, isTiff(new Uint8Array(await file.slice(0, 2).arrayBuffer())) ? 'tiff' : 'image', keep);
    case 'pdf': return cleanPdf(new Uint8Array(await file.arrayBuffer()), keep, (jpg) => cleanImageBytes('x.jpg', jpg, keep));
    case 'office': return cleanOffice(new Uint8Array(await file.arrayBuffer()), keep, (n, b) => cleanImageBytes(n, b, keep));
    case 'svg': return new TextEncoder().encode(cleanSvg(await file.text(), keep));
    case 'text': return new Uint8Array(await file.arrayBuffer());
    default: throw new Error('unsupported');
  }
}

self.onmessage = async ({ data: req }: MessageEvent<Req>) => {
  try {
    if (req.op === 'read') {
      postMessage({ id: req.id, tags: await read(req.file, req.kind) } satisfies Res);
    } else {
      const bytes = req.op === 'scrub'
        ? await (await perl).scrub(req.file.name, req.file, req.tags)
        : await clean(req.file, req.kind, req.keep);
      postMessage({ id: req.id, bytes } satisfies Res, { transfer: [bytes.buffer as ArrayBuffer] });
    }
  } catch (e) {
    postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) } satisfies Res);
  }
};
