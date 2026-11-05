// Decide which engine handles a file. By content (magic bytes) first, extension only as a tie-breaker.
export type Kind = 'image' | 'raw' | 'av' | 'pdf' | 'office' | 'svg' | 'text' | 'unsupported';

const ascii = (b: Uint8Array, from: number, len: number) => String.fromCharCode(...b.subarray(from, from + len));
export const RAW = /^(dng|cr2|cr3|crw|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f|3fr|iiq|erf|mef|mos|kdc|dcr|rwl)$/;
export const OFFICE = /^(docx|docm|dotx|xlsx|xlsm|xltx|pptx|pptm|potx|ppsx|odt|ods|odp|odg)$/;
const TEXT = /^(txt|md|markdown|csv|tsv|json|jsonc|yaml|yml|toml|ini|cfg|conf|log|xml|html?|css|scss|less|js|mjs|cjs|ts|tsx|jsx|py|rb|go|rs|java|kt|kts|swift|c|h|cc|cpp|hpp|cs|php|sh|bash|zsh|fish|ps1|bat|sql|r|lua|pl|dart|vue|svelte|tex|srt|vtt|env|gitignore)$/;

export function ext(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
}

/** `head` = first 192 bytes of the file. */
export function detect(name: string, head: Uint8Array): Kind {
  const e = ext(name);
  const b = head;
  if (b[0] === 0xff && b[1] === 0xd8) return 'image'; // JPEG
  if (ascii(b, 1, 3) === 'PNG') return 'image';
  if (ascii(b, 0, 3) === 'GIF') return 'image';
  if (ascii(b, 0, 4) === 'RIFF') {
    const sub = ascii(b, 8, 4);
    if (sub === 'WEBP') return 'image';
    if (sub === 'WAVE' || sub === 'AVI ') return 'av';
  }
  if (ascii(b, 0, 4) === '%PDF') return 'pdf';
  if (ascii(b, 4, 4) === 'ftyp') {
    const brand = ascii(b, 8, 4);
    if (/^(heic|heix|heim|heis|hevc|hevx|mif1|msf1|avif|avis)$/.test(brand)) return 'image';
    if (brand === 'crx ') return 'raw'; // Canon CR3
    return 'av'; // mp4, mov (qt  ), m4a, 3gp...
  }
  if (ascii(b, 4, 4) === 'moov' || ascii(b, 4, 4) === 'mdat' || ascii(b, 4, 4) === 'wide') return 'av'; // old QuickTime
  if ((b[0] === 0x49 && b[1] === 0x49) || (b[0] === 0x4d && b[1] === 0x4d)) return RAW.test(e) ? 'raw' : 'image'; // TIFF family
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'av'; // MP3
  if (ascii(b, 0, 4) === 'fLaC' || ascii(b, 0, 4) === 'OggS') return 'av';
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'av'; // Matroska / WebM
  if (ascii(b, 0, 4) === 'FORM' && /^(AIFF|AIFC)$/.test(ascii(b, 8, 4))) return 'av';
  if (b[0] === 0x30 && b[1] === 0x26 && b[2] === 0xb2 && b[3] === 0x75) return 'av'; // ASF: wmv, wma
  if ((b[0] === 0x47 && b[188] === 0x47) || (/^(mts|m2ts|ts)$/.test(e) && (b[0] === 0x47 || b[4] === 0x47))) return 'av'; // MPEG-TS / AVCHD (a lone 0x47 is just 'G')
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0xba) return 'av'; // MPEG-PS (.mpg/.vob)
  if (ascii(b, 0, 4) === '8BPS') return 'image'; // Photoshop PSD/PSB (ExifTool writes it)
  if (b[0] === 0x50 && b[1] === 0x4b && OFFICE.test(e)) return 'office'; // zip-based docs
  if (RAW.test(e)) return 'raw';
  if (e === 'svg' || /<svg[\s>]/i.test(ascii(b, 0, b.length))) return 'svg';
  if (TEXT.test(e) && !b.subarray(0, 64).includes(0)) return 'text';
  return 'unsupported';
}
