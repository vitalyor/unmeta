// PDF: full rewrite with pdf-lib (ExifTool appends edits, so the old values stay recoverable).
// Besides the Info dict and XMP: embedded JPEG photos keep their own EXIF/GPS, annotations carry author names.
import {
  PDFDocument, PDFName, PDFDict, PDFRawStream, PDFNumber, PDFString, PDFHexString, PDFRef, PDFArray, PDFStream,
  type PDFObject,
} from 'pdf-lib';
import type { Category } from './categories';

type CleanImage = (jpeg: Uint8Array) => Promise<Uint8Array>;

const INFO_KEEP: Partial<Record<Category, string[]>> = {
  author: ['Author'],
  software: ['Creator', 'Producer'],
  dates: ['CreationDate', 'ModDate'],
  descriptions: ['Title', 'Subject', 'Keywords'],
};

/** JPEG photos embedded in the PDF (each may carry its own EXIF/GPS). */
export async function pdfJpegs(bytes: Uint8Array): Promise<Uint8Array[]> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
  const out: Uint8Array[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode')) out.push(obj.contents);
  }
  return out;
}

export async function cleanPdf(bytes: Uint8Array, keep: Category[], cleanJpeg: CleanImage): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (e) {
    if (/encrypt/i.test(String(e))) throw new Error('pdf-encrypted');
    throw e;
  }
  const ctx = doc.context;

  // Info dict: rebuild with only the kept fields.
  const oldInfo = ctx.lookup(ctx.trailerInfo.Info);
  const info = ctx.obj({});
  if (oldInfo instanceof PDFDict) {
    for (const c of keep) for (const k of INFO_KEEP[c] ?? []) {
      const v = oldInfo.get(PDFName.of(k));
      if (v instanceof PDFString || v instanceof PDFHexString) info.set(PDFName.of(k), v);
    }
  }
  ctx.trailerInfo.Info = info.keys().length ? ctx.register(info) : undefined;

  for (const [ref, obj] of ctx.enumerateIndirectObjects()) {
    const dict = obj instanceof PDFDict ? obj : obj instanceof PDFRawStream ? obj.dict : null;
    if (!dict) continue;
    dict.delete(PDFName.of('Metadata')); // XMP on catalog, pages, images
    dict.delete(PDFName.of('PieceInfo')); // private app data (Illustrator, Photoshop)
    if (!keep.includes('author') && dict.get(PDFName.of('Type')) === PDFName.of('Annot')) dict.delete(PDFName.of('T'));
    if (!keep.includes('dates') && dict.get(PDFName.of('Type')) === PDFName.of('Annot')) {
      dict.delete(PDFName.of('M')); dict.delete(PDFName.of('CreationDate'));
    }
    // Embedded photos: JPEG streams carry their own EXIF.
    if (obj instanceof PDFRawStream && dict.get(PDFName.of('Filter')) === PDFName.of('DCTDecode')) {
      const clean = await cleanJpeg(obj.contents);
      if (clean.length !== obj.contents.length || clean.some((b, i) => b !== obj.contents[i])) {
        dict.set(PDFName.of('Length'), PDFNumber.of(clean.length));
        ctx.assign(ref, PDFRawStream.of(dict, clean));
      }
    }
  }
  if (!keep.includes('c2pa')) dropC2pa(doc);
  collectGarbage(doc);
  return doc.save({ useObjectStreams: true, addDefaultPage: false, updateFieldAppearances: false });
}

// C2PA manifests are attached as an "associated file" (catalog /AF, also listed in /Names/EmbeddedFiles).
// Only those are removed; the user's own attachments stay.
function dropC2pa(doc: PDFDocument) {
  const ctx = doc.context;
  const isC2pa = (spec: PDFObject | undefined): boolean => {
    const d = spec instanceof PDFRef ? ctx.lookup(spec) : spec;
    if (!(d instanceof PDFDict)) return false;
    if (d.get(PDFName.of('AFRelationship')) === PDFName.of('C2PA_Manifest')) return true;
    const ef = ctx.lookup(d.get(PDFName.of('EF')));
    const f = ef instanceof PDFDict ? ctx.lookup(ef.get(PDFName.of('F'))) : undefined;
    const sub = f instanceof PDFStream ? f.dict.get(PDFName.of('Subtype')) : undefined;
    return sub instanceof PDFName && /c2pa/i.test(sub.decodeText());
  };
  const cat = doc.catalog;
  const af = ctx.lookup(cat.get(PDFName.of('AF')));
  if (af instanceof PDFArray) {
    const keep = af.asArray().filter((s) => !isC2pa(s));
    if (keep.length) cat.set(PDFName.of('AF'), ctx.obj(keep)); else cat.delete(PDFName.of('AF'));
  }
  const names = ctx.lookup(cat.get(PDFName.of('Names')));
  const tree = names instanceof PDFDict ? ctx.lookup(names.get(PDFName.of('EmbeddedFiles'))) : undefined;
  const list = tree instanceof PDFDict ? ctx.lookup(tree.get(PDFName.of('Names'))) : undefined;
  if (list instanceof PDFArray) {
    const a = list.asArray(), kept: PDFObject[] = [];
    for (let i = 0; i + 1 < a.length; i += 2) if (!isC2pa(a[i + 1])) kept.push(a[i], a[i + 1]);
    (tree as PDFDict).set(PDFName.of('Names'), ctx.obj(kept));
  }
}

// pdf-lib writes every object in the context, referenced or not. Without this, the old Info dict
// and XMP streams would still sit (compressed) in the output and be recoverable.
function collectGarbage(doc: PDFDocument) {
  const ctx = doc.context;
  const seen = new Set<string>();
  const stack: PDFObject[] = [ctx.trailerInfo.Root, ctx.trailerInfo.Info].filter(Boolean) as PDFObject[];
  while (stack.length) {
    let o = stack.pop()!;
    if (o instanceof PDFRef) {
      if (seen.has(o.tag)) continue;
      seen.add(o.tag);
      const t = ctx.lookup(o);
      if (!t) continue;
      o = t;
    }
    if (o instanceof PDFDict) stack.push(...o.values());
    else if (o instanceof PDFArray) stack.push(...o.asArray());
    else if (o instanceof PDFStream) stack.push(...o.dict.values());
  }
  for (const [ref] of ctx.enumerateIndirectObjects()) if (!seen.has(ref.tag)) ctx.delete(ref);
}
