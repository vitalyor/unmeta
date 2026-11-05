// Big JPEG/PNG: ExifTool in WebAssembly rewrites ~2 MB/s (a 37 MB PNG took 20 s, minutes on a cheap phone).
// Give it only the metadata skeleton — image data swapped for a tiny placeholder — then splice the original
// image bytes back, unchanged. Anything unusual → null, and the caller uses the normal (slow) path.
// The post-clean re-read still verifies the final file.

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const u32 = (b: Uint8Array, o: number) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const EMPTY_IDAT = new Uint8Array([0, 0, 0, 0, 0x49, 0x44, 0x41, 0x54, 0x35, 0xaf, 0x06, 0x1e]); // length 0 + "IDAT" + CRC

export interface Skeleton { stub: Uint8Array; restore(cleaned: Uint8Array): Uint8Array | null }

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

function pngChunks(b: Uint8Array): { type: string; start: number; end: number }[] | null {
  if (!PNG_SIG.every((v, i) => b[i] === v)) return null;
  const out = [];
  for (let o = 8; o + 12 <= b.length;) {
    const len = u32(b, o), end = o + 12 + len;
    if (end > b.length) return null;
    out.push({ type: String.fromCharCode(b[o + 4], b[o + 5], b[o + 6], b[o + 7]), start: o, end });
    o = end;
    if (out[out.length - 1].type === 'IEND') break;
  }
  return out;
}

function png(b: Uint8Array): Skeleton | null {
  const chunks = pngChunks(b);
  if (!chunks || !chunks.some((c) => c.type === 'IDAT')) return null;
  const idat = concat(chunks.filter((c) => c.type === 'IDAT').map((c) => b.subarray(c.start, c.end)));
  const parts: Uint8Array[] = [b.subarray(0, 8)];
  let placed = false;
  for (const c of chunks) {
    if (c.type !== 'IDAT') parts.push(b.subarray(c.start, c.end));
    else if (!placed) { parts.push(EMPTY_IDAT); placed = true; }
  }
  return {
    stub: concat(parts),
    restore(out) {
      const oc = pngChunks(out);
      const holes = oc?.filter((c) => c.type === 'IDAT') ?? [];
      if (holes.length !== 1 || holes[0].end - holes[0].start !== 12) return null;
      return concat([out.subarray(0, holes[0].start), idat, out.subarray(holes[0].end)]);
    },
  };
}

/** Header segments up to the first SOS; returns SOS offset and the SOS segment's end, or null. */
function jpegHeader(b: Uint8Array): { sos: number; scan: number; mpf: boolean } | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let o = 2, mpf = false;
  while (o + 4 <= b.length) {
    if (b[o] !== 0xff) return null;
    const m = b[o + 1];
    if (m === 0xff) { o++; continue; } // fill byte
    const len = (b[o + 2] << 8) | b[o + 3];
    if (m === 0xe2 && b[o + 4] === 0x4d && b[o + 5] === 0x50 && b[o + 6] === 0x46) mpf = true; // "MPF": offsets into the file
    if (m === 0xda) return { sos: o, scan: o + 2 + len, mpf };
    o += 2 + len;
  }
  return null;
}

function jpeg(b: Uint8Array): Skeleton | null {
  const h = jpegHeader(b);
  if (!h) return null;
  // entropy data (+ any later progressive scans) up to EOI; bail on metadata markers inside it
  let eoi = -1;
  for (let i = h.scan; i < b.length - 1; i++) {
    if (b[i] !== 0xff) continue;
    const m = b[i + 1];
    if (m === 0x00 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) continue;
    if (m === 0xd9) { eoi = i + 2; break; }
    if ((m >= 0xe0 && m <= 0xef) || m === 0xfe) return null; // APPn/COM between scans: let ExifTool see everything
  }
  if (eoi < 0) return null;
  const trailer = b.subarray(eoi);
  if (h.mpf && trailer.length) return null; // MPF stores offsets of the trailing images; splicing would break them
  const body = b.subarray(h.sos, eoi);
  const sosSeg = b.subarray(h.sos, h.scan);
  const stub = concat([b.subarray(0, h.sos), sosSeg, new Uint8Array([0x00, 0xff, 0xd9]), trailer]);
  return {
    stub,
    restore(out) {
      const oh = jpegHeader(out);
      if (!oh || oh.scan - oh.sos !== sosSeg.length) return null;
      const stubEnd = oh.scan + 3;
      if (out[oh.scan] !== 0x00 || out[oh.scan + 1] !== 0xff || out[oh.scan + 2] !== 0xd9) return null;
      return concat([out.subarray(0, oh.sos), body, out.subarray(stubEnd)]);
    },
  };
}

/** Byte-sequence search (jumps on the first byte, so it's fast on large buffers). */
export function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from = 0): number {
  if (!needle.length) return -1;
  for (let i = hay.indexOf(needle[0], from); i >= 0 && i <= hay.length - needle.length; i = hay.indexOf(needle[0], i + 1)) {
    let k = 1; while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
}

/** Smart objects and linked layers carry whole embedded documents with their own XMP (app versions,
 * document ids, history) — invisible to ExifTool. Blank every XMP packet inside the layer section in place
 * (same length, so no offset or section length changes). Pixel data after the layer section is untouched. */
function scrubLayerXmp(rest: Uint8Array, psb: boolean): Uint8Array {
  const out = rest.slice();
  const layerLen = psb ? u32(out, 0) * 2 ** 32 + u32(out, 4) : u32(out, 0);
  const end = Math.min(out.length, (psb ? 8 : 4) + layerLen);
  const find = (needle: string, from: number) => { const i = indexOfBytes(out, new TextEncoder().encode(needle), from); return i >= 0 && i < end ? i : -1; };
  for (let i = find('<x:xmpmeta', 0); i >= 0; i = find('<x:xmpmeta', i + 1)) {
    const close = find('</x:xmpmeta>', i);
    if (close < 0) break;
    out.fill(0x20, i, close + 12); // spaces: a padded, empty XMP packet
  }
  return out;
}

/** Photoshop PSD/PSB: header, colour-mode data, image resources (all the metadata), then layers and pixels.
 * Sections are length-prefixed with no absolute offsets, so layers + pixels can be cut out and put back. */
function psd(b: Uint8Array): Skeleton | null {
  if (b[0] !== 0x38 || b[1] !== 0x42 || b[2] !== 0x50 || b[3] !== 0x53) return null; // "8BPS"
  const psb = b[5] === 2;
  const resEnd = (x: Uint8Array) => {
    let o = 26;
    if (o + 4 > x.length) return -1;
    o += 4 + u32(x, o); // colour mode data
    if (o + 4 > x.length) return -1;
    o += 4 + u32(x, o); // image resources
    return o <= x.length ? o : -1;
  };
  const end = resEnd(b);
  if (end < 0) return null;
  const tail = new Uint8Array(psb ? 10 : 6); // empty layer section (4 or 8 bytes length) + raw compression flag
  return {
    stub: concat([b.subarray(0, end), tail]),
    restore(out) {
      const oe = resEnd(out);
      if (oe < 0 || out.length !== oe + tail.length || out.subarray(oe).some((v) => v !== 0)) return null;
      return concat([out.subarray(0, oe), scrubLayerXmp(b.subarray(end), psb)]);
    },
  };
}

export function skeleton(b: Uint8Array): Skeleton | null {
  return b[0] === 0x89 ? png(b) : b[0] === 0xff ? jpeg(b) : b[0] === 0x38 ? psd(b) : null;
}
