// Office Open XML (docx/xlsx/pptx) and OpenDocument (odt/ods/odp): zip + XML.
// ExifTool can only read these. Leaks live in doc properties, comments/tracked changes,
// revision ids, thumbnails and embedded photos (which keep their own EXIF/GPS).
import { unzipSync, zipSync, strToU8, strFromU8, type Zippable } from 'fflate';
import type { Category, Tag } from './categories';

type CleanImage = (name: string, bytes: Uint8Array) => Promise<Uint8Array>;
const has = (keep: Category[], c: Category) => keep.includes(c);

// docProps/core.xml (OOXML) — element per category.
const CORE: Partial<Record<Category, RegExp>> = {
  author: /<(dc:creator|cp:lastModifiedBy)\b[^>]*>[\s\S]*?<\/\1>|<(dc:creator|cp:lastModifiedBy)\b[^>]*\/>/g,
  dates: /<(dcterms:created|dcterms:modified|cp:lastPrinted)\b[^>]*>[\s\S]*?<\/\1>/g,
  descriptions: /<(dc:title|dc:subject|dc:description|cp:keywords|cp:category|cp:contentStatus)\b[^>]*>[\s\S]*?<\/\1>/g,
  software: /<(cp:revision|cp:version)\b[^>]*>[\s\S]*?<\/\1>/g,
};
// docProps/app.xml — elements that identify org, people, software, editing time.
const APP_AUTHOR = /<(Company|Manager|HyperlinkBase)\b[^>]*>[\s\S]*?<\/\1>/g;
const APP_SOFTWARE = /<(Application|AppVersion|Template|TotalTime|DocSecurity)\b[^>]*>[\s\S]*?<\/\1>/g;
// meta.xml (ODF)
const ODF: Partial<Record<Category, RegExp>> = {
  author: /<(meta:initial-creator|dc:creator|meta:printed-by)\b[^>]*>[\s\S]*?<\/\1>/g,
  dates: /<(meta:creation-date|dc:date|meta:print-date)\b[^>]*>[\s\S]*?<\/\1>/g,
  descriptions: /<(dc:title|dc:subject|dc:description|meta:keyword)\b[^>]*>[\s\S]*?<\/\1>/g,
  software: /<(meta:generator|meta:editing-cycles|meta:editing-duration|meta:template)\b[^>]*>[\s\S]*?<\/\1>|<meta:template\b[^>]*\/>/g,
};
const IMAGE = /\.(jpe?g|png|tiff?|gif|webp|heic)$/i;
const ZIP_EPOCH = new Date(1980, 0, 1);

// --- reading (ExifTool doesn't reliably parse Office XML, so we read the properties ourselves)
const NAMES: Record<string, string> = {
  creator: 'Creator', lastModifiedBy: 'LastModifiedBy', created: 'CreateDate', modified: 'ModifyDate', lastPrinted: 'LastPrintedDate',
  title: 'Title', subject: 'Subject', description: 'Description', keywords: 'Keywords', keyword: 'Keywords', category: 'Category',
  contentStatus: 'ContentStatus', revision: 'Revision', version: 'Revision', Application: 'Application', AppVersion: 'AppVersion',
  Company: 'Company', Manager: 'Manager', TotalTime: 'TotalTime', Template: 'Template', HyperlinkBase: 'Author',
  generator: 'Generator', 'initial-creator': 'InitialCreator', 'creation-date': 'CreateDate', date: 'ModifyDate',
  'editing-duration': 'EditingDuration', 'editing-cycles': 'EditingCycles', 'printed-by': 'PrintedBy', 'print-date': 'PrintDate',
};
const decode = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function readOffice(bytes: Uint8Array): { tags: Tag[]; images: [string, Uint8Array][] } {
  const files = unzipSync(bytes);
  const tags: Tag[] = [];
  const add = (name: string, value: string) => { if (value.trim()) tags.push({ group0: 'Office', group1: 'Office', group2: '', name, value: decode(value).slice(0, 200) }); };
  for (const p of ['docProps/core.xml', 'docProps/app.xml', 'meta.xml']) {
    if (!files[p]) continue;
    for (const m of strFromU8(files[p]).matchAll(/<(?:[\w-]+:)?([\w-]+)\b[^>]*>([^<]+)<\/(?:[\w-]+:)?\1>/g)) if (NAMES[m[1]]) add(NAMES[m[1]], m[2]);
    for (const m of strFromU8(files[p]).matchAll(/<meta:user-defined\b[^>]*meta:name="([^"]*)"[^>]*>([^<]*)</g)) add('CustomProperty', `${m[1]}: ${m[2]}`);
  }
  if (files['docProps/custom.xml']) for (const m of strFromU8(files['docProps/custom.xml']).matchAll(/<property\b[^>]*name="([^"]*)"[^>]*>[\s\S]*?>([^<]*)</g)) add('CustomProperty', `${m[1]}: ${m[2]}`);
  const people = new Set<string>(), dates = new Set<string>();
  for (const [p, d] of Object.entries(files)) {
    if (!/\.xml$/.test(p) || /^docProps\//.test(p)) continue;
    const s = strFromU8(d);
    for (const m of s.matchAll(/\b(?:w:author|w15:author|author)="([^"]+)"/g)) people.add(m[1]);
    for (const m of s.matchAll(/<p:cmAuthor\b[^>]*\bname="([^"]+)"/g)) people.add(m[1]);
    for (const m of s.matchAll(/<author>([^<]+)<\/author>/g)) people.add(m[1]);
    for (const m of s.matchAll(/<dc:creator>([^<]+)<\/dc:creator>/g)) if (p !== 'meta.xml') people.add(m[1]);
    for (const m of s.matchAll(/\bw:date="([^"]+)"|<dc:date>([^<]+)<\/dc:date>/g)) if (p !== 'meta.xml') dates.add(m[1] ?? m[2]);
    for (const m of s.matchAll(/config:name="PrinterName"[^>]*>([^<]+)</g)) add('PrinterName', m[1]);
  }
  for (const v of people) add('CommentAuthor', v);
  for (const v of dates) add('RevisionDate', v);
  for (const p of Object.keys(files)) if (/^(docProps\/thumbnail\.|Thumbnails\/thumbnail\.)/.test(p)) tags.push({ group0: 'Office', group1: 'Office', group2: 'Preview', name: 'Thumbnail', value: p });
  const images = Object.entries(files).filter(([p]) => IMAGE.test(p) && !/thumbnail/i.test(p));
  return { tags, images };
}

export async function cleanOffice(bytes: Uint8Array, keep: Category[], cleanImage: CleanImage): Promise<Uint8Array> {
  const files = unzipSync(bytes);
  const out: Zippable = {};
  const odf = 'mimetype' in files;
  const xml = (path: string, fn: (s: string) => string) => { if (files[path]) files[path] = strToU8(fn(strFromU8(files[path]))); };

  if (odf) {
    xml('meta.xml', (s) => {
      for (const [c, re] of Object.entries(ODF) as [Category, RegExp][]) if (!has(keep, c)) s = s.replace(re, '');
      return s.replace(/<meta:user-defined\b[^>]*>[\s\S]*?<\/meta:user-defined>/g, '');
    });
    if (!has(keep, 'thumbnails')) delete files['Thumbnails/thumbnail.png'];
    if (!has(keep, 'author')) {
      // comments and tracked changes carry author names and dates
      for (const p of ['content.xml', 'styles.xml']) xml(p, (s) => s
        .replace(/<dc:creator>[\s\S]*?<\/dc:creator>/g, '<dc:creator></dc:creator>')
        .replace(/<dc:date>[\s\S]*?<\/dc:date>/g, ''));
    }
    xml('settings.xml', (s) => s.replace(/<config:config-item config:name="PrinterName"[\s\S]*?<\/config:config-item>/g, '')
      .replace(/<config:config-item config:name="PrinterSetup"[\s\S]*?<\/config:config-item>/g, ''));
  } else {
    xml('docProps/core.xml', (s) => {
      for (const [c, re] of Object.entries(CORE) as [Category, RegExp][]) if (!has(keep, c)) s = s.replace(re, '');
      return s;
    });
    xml('docProps/app.xml', (s) => {
      if (!has(keep, 'author')) s = s.replace(APP_AUTHOR, '');
      if (!has(keep, 'software')) s = s.replace(APP_SOFTWARE, '');
      return s;
    });
    // custom properties: arbitrary, often org-identifying (DMS ids, client names) — always out
    if (files['docProps/custom.xml']) {
      delete files['docProps/custom.xml'];
      xml('[Content_Types].xml', (s) => s.replace(/<Override[^>]*PartName="\/docProps\/custom\.xml"[^>]*\/>/g, ''));
      xml('_rels/.rels', (s) => s.replace(/<Relationship[^>]*Target="\/?docProps\/custom\.xml"[^>]*\/>/g, ''));
    }
    if (!has(keep, 'thumbnails')) {
      for (const p of Object.keys(files)) if (/^docProps\/thumbnail\./.test(p)) {
        delete files[p];
        xml('[Content_Types].xml', (s) => s.replace(new RegExp(`<Override[^>]*PartName="/${p.replace('.', '\\.')}"[^>]*/>`, 'g'), ''));
        xml('_rels/.rels', (s) => s.replace(new RegExp(`<Relationship[^>]*Target="/?${p.replace('.', '\\.')}"[^>]*/>`, 'g'), ''));
      }
    }
    if (!has(keep, 'author')) {
      delete files['word/people.xml'];
      xml('word/_rels/document.xml.rels', (s) => s.replace(/<Relationship[^>]*Target="people\.xml"[^>]*\/>/g, ''));
      xml('[Content_Types].xml', (s) => s.replace(/<Override[^>]*PartName="\/word\/people\.xml"[^>]*\/>/g, ''));
      for (const p of Object.keys(files)) {
        if (!/\.xml$/.test(p)) continue;
        // comments, tracked changes (w:author, w:initials, w:date), pptx comment authors, xlsx comment authors
        xml(p, (s) => s
          .replace(/\b(w:author|w:initials|w15:author|author|w15:userId|w15:providerId)="[^"]*"/g, (_, a) => `${a}=""`)
          .replace(/<(p:cmAuthor|authors)\b[\s\S]*?<\/\1>|<p:cmAuthor\b[^>]*\/>/g, (m) => m.replace(/(name|initials)="[^"]*"/g, '$1=""'))
          .replace(/<author>[^<]*<\/author>/g, '<author></author>'));
      }
    }
    if (!has(keep, 'dates')) {
      for (const p of Object.keys(files)) if (/\.xml$/.test(p)) xml(p, (s) => s.replace(/\bw:date="[^"]*"/g, ''));
    }
    // Revision session ids fingerprint the editing machine/session across documents.
    for (const p of Object.keys(files)) if (/^word\/.*\.xml$/.test(p)) xml(p, (s) => s
      .replace(/\s+w:rsid\w*="[^"]*"/g, '')
      .replace(/<w:rsids>[\s\S]*?<\/w:rsids>/g, ''));
  }

  for (const [path, data] of Object.entries(files)) {
    // No silent fallback: an embedded photo we failed to clean must fail the whole file.
    out[path] = IMAGE.test(path) ? await cleanImage(path, data) : data;
  }
  if (odf) {
    // ODF requires "mimetype" as the first entry, stored uncompressed. Re-assigning keeps key position.
    const mt = out.mimetype as Uint8Array;
    const ordered: Zippable = { mimetype: mt, ...out };
    ordered.mimetype = [mt, { level: 0 }];
    return zipSync(ordered, { level: 6, mtime: ZIP_EPOCH });
  }
  return zipSync(out, { level: 6, mtime: ZIP_EPOCH }); // zip entry times would leak edit dates
}
