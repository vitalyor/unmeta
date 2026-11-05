// What the engine does with one Perl/ExifTool instance: read everything, clean photos, PDF, Office, SVG.
// Runs inside the browser worker (engine.worker.ts) and in-process on the server (server/engine.ts).
import type { Perl } from './perl';
import { cleanPdf, pdfJpegs } from './pdf';
import { cleanOffice, readOffice } from './office';
import { cleanSvg } from './svg';
import { detect, type Kind } from './detect';
import type { Category, Tag } from './categories';

export type Job =
  | { op: 'read'; file: File; kind: Kind }
  | { op: 'clean'; file: File; kind: Kind; keep: Category[] }
  | { op: 'scrub'; file: File; tags: Tag[] };
export type Req = Job & { id: number };
export type Res = { id: number; tags?: Tag[]; bytes?: Uint8Array; error?: string };

const isTiff = (b: Uint8Array) => (b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d);

async function cleanImageBytes(p: Perl, name: string, bytes: Uint8Array, keep: Category[]) {
  if (detect(name, bytes.subarray(0, 64)) !== 'image') return bytes;
  return p.clean(name, bytes, isTiff(bytes) ? 'tiff' : 'image', keep);
}

/** Tags of embedded photos, labelled with where they were found. */
async function embeddedTags(p: Perl, images: [string, Uint8Array][]): Promise<Tag[]> {
  const out: Tag[] = [];
  for (const [where, bytes] of images) {
    for (const t of (await p.read(where, bytes)).tags) out.push({ ...t, value: `${t.value} (${where})` });
  }
  return out;
}

async function read(p: Perl, file: File, kind: Kind): Promise<Tag[]> {
  if (kind === 'office') {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { tags, images } = readOffice(bytes);
    const zip = (await p.read(file.name, file)).tags.filter((t) => t.group0 === 'ZIP' && t.name === 'ZipModifyDate').slice(0, 1);
    return [...tags, ...zip, ...(await embeddedTags(p, images))];
  }
  const tags = (await p.read(file.name, file)).tags;
  if (kind === 'pdf') {
    const jpegs = await pdfJpegs(new Uint8Array(await file.arrayBuffer())).catch(() => []);
    tags.push(...(await embeddedTags(p, jpegs.map((b, i) => [`image${i + 1}.jpg`, b] as [string, Uint8Array]))));
  }
  return tags;
}

async function clean(p: Perl, file: File, kind: Kind, keep: Category[]): Promise<Uint8Array> {
  switch (kind) {
    case 'image': return p.clean(file.name, file, isTiff(new Uint8Array(await file.slice(0, 2).arrayBuffer())) ? 'tiff' : 'image', keep);
    case 'pdf': return cleanPdf(new Uint8Array(await file.arrayBuffer()), keep, (jpg) => cleanImageBytes(p, 'x.jpg', jpg, keep));
    case 'office': return cleanOffice(new Uint8Array(await file.arrayBuffer()), keep, (n, b) => cleanImageBytes(p, n, b, keep));
    case 'svg': return new TextEncoder().encode(cleanSvg(await file.text(), keep));
    case 'text': return new Uint8Array(await file.arrayBuffer());
    default: throw new Error('unsupported');
  }
}

/** One job. Perl is not reentrant: callers must run jobs one at a time. */
export async function run(p: Perl, job: Job): Promise<Omit<Res, 'id'>> {
  try {
    if (job.op === 'read') return { tags: await read(p, job.file, job.kind) };
    return { bytes: job.op === 'scrub' ? await p.scrub(job.file.name, job.file, job.tags) : await clean(p, job.file, job.kind, job.keep) };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
