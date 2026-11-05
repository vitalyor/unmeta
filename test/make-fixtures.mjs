// Generates test/fixtures: small files with KNOWN sensitive metadata (all fake: "Ivan Petrov",
// Moscow coordinates, marker UNMETASECRET). Needs native ffmpeg + sips (macOS). Output is committed,
// so tests don't need these tools. Run: node test/make-fixtures.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib';
import { zipSync, strToU8 } from 'fflate';

const DIR = new URL('./fixtures/', import.meta.url).pathname;
const TMP = new URL('./.tmp/', import.meta.url).pathname;
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR); mkdirSync(TMP, { recursive: true });
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const M = ['-metadata', 'title=UNMETASECRET title', '-metadata', 'artist=Ivan Petrov', '-metadata', 'comment=UNMETASECRET',
  '-metadata', 'creation_time=2025-05-03T14:35:22Z'];

// --- Perl/ExifTool for writing tags
const fs = new MemoryFileSystem({ '/': '' });
let err = '';
const perl = await ZeroPerl.create({ fileSystem: fs, stderr: (s) => { err += s; } });
await perl.eval('use Image::ExifTool;');
async function tag(src, dst, tags) {
  fs.addFile('/src', readFileSync(src));
  const set = tags.map(([k, v]) => `$et->SetNewValue('${k}', '${String(v).replace(/'/g, "\\'")}');`).join('');
  const r = await perl.eval(`my $et = Image::ExifTool->new; ${set} $et->WriteInfo('/src', '/dst') or die $et->GetValue('Error');`);
  if (!r.success) throw new Error(dst + ': ' + err + perl.getLastError());
  writeFileSync(dst, fs.lookup('/dst').content);
  fs.removeFile('/src'); fs.removeFile('/dst');
}
const PHOTO = [
  ['GPSLatitude', 55.7558], ['GPSLatitudeRef', 'N'], ['GPSLongitude', 37.6173], ['GPSLongitudeRef', 'E'],
  ['Make', 'Apple'], ['Model', 'iPhone 15 Pro'], ['SerialNumber', 'SN-UNMETASECRET'], ['LensModel', 'iPhone back camera'],
  ['Artist', 'Ivan Petrov'], ['Copyright', 'Ivan Petrov'], ['XMP-dc:Creator', 'Ivan Petrov'],
  ['Software', 'SecretEditor 1.0'], ['DateTimeOriginal', '2025:05:03 14:35:22'], ['CreateDate', '2025:05:03 14:35:22'],
  ['ImageDescription', 'UNMETASECRET home'], ['XMP-dc:Title', 'UNMETASECRET'], ['Orientation#', 6],
];

// --- photos
ff('-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=1', '-frames:v', '1', `${TMP}p.jpg`);
ff('-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=1', '-frames:v', '1', `${TMP}thumb.jpg`);
ff('-f', 'lavfi', '-i', 'testsrc2=size=640x480:rate=1', '-frames:v', '1', `${TMP}p.png`);
ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=1', '-frames:v', '1', `${TMP}p.tif`);
ff('-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=5', '-t', '1', `${TMP}p.gif`);
execFileSync('sips', ['-s', 'format', 'heic', `${TMP}p.jpg`, '--out', `${TMP}p.heic`], { stdio: 'ignore' });
await tag(`${TMP}p.jpg`, `${TMP}p2.jpg`, PHOTO);
fs.addFile('/thumb', readFileSync(`${TMP}thumb.jpg`));
// embed a thumbnail (category "thumbnails") into the JPEG
fs.addFile('/src', readFileSync(`${TMP}p2.jpg`));
await perl.eval(`my $et = Image::ExifTool->new; open my $h, '<', '/thumb'; binmode $h; local $/; my $t = <$h>; $et->SetNewValue('ThumbnailImage', \\$t); $et->WriteInfo('/src', '/dst') or die;`);
writeFileSync(`${DIR}photo.jpg`, fs.lookup('/dst').content); fs.removeFile('/src'); fs.removeFile('/dst');
await tag(`${TMP}p.png`, `${DIR}photo.png`, PHOTO);
// >1 MB: exercises the skeleton path (metadata-only rewrite + original image data spliced back)
ff('-f', 'lavfi', '-i', 'nullsrc=size=1400x1400,geq=random(1)*255:random(2)*255:128', '-frames:v', '1', '-q:v', '2', `${TMP}big.jpg`);
ff('-f', 'lavfi', '-i', 'nullsrc=size=700x700,geq=random(1)*255:random(2)*255:128', '-frames:v', '1', `${TMP}big.png`);
await tag(`${TMP}big.jpg`, `${DIR}photo-big.jpg`, PHOTO);
await tag(`${TMP}big.png`, `${DIR}photo-big.png`, PHOTO);
await tag(`${TMP}p.tif`, `${DIR}photo.tif`, PHOTO);
await tag(`${TMP}p.heic`, `${DIR}photo.heic`, PHOTO);
await tag(`${TMP}p.gif`, `${DIR}photo.gif`, [['XMP-dc:Creator', 'Ivan Petrov'], ['Comment', 'UNMETASECRET']]);

// --- video / audio
const V = ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '1'];
const A = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1'];
// portrait phone video: display matrix = rotate 90° clockwise (ffmpeg's display_rotation is anticlockwise)
ff(...V, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', `${TMP}v0.mp4`);
ff('-display_rotation:v:0', '-90', '-i', `${TMP}v0.mp4`, '-c', 'copy', `${TMP}v.mp4`);
ff('-display_rotation:v:0', '-90', '-i', `${TMP}v0.mp4`, '-c', 'copy', `${TMP}v.mov`);
const VID = [['Keys:GPSCoordinates', '55.7558 37.6173'], ['Keys:Make', 'Apple'], ['Keys:Model', 'iPhone 15 Pro'],
  ['Keys:CreationDate', '2025:05:03 14:35:22+03:00'], ['UserData:Artist', 'Ivan Petrov'],
  ['QuickTime:CreateDate', '2025:05:03 14:35:22'], ['XMP-dc:Creator', 'Ivan Petrov']];
await tag(`${TMP}v.mp4`, `${DIR}video.mp4`, VID);
await tag(`${TMP}v.mov`, `${DIR}video.mov`, VID);
ff(...V, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', ...M, '-metadata', 'location=+55.7558+037.6173/', `${DIR}video.mkv`);
ff(...V, '-c:v', 'libvpx-vp9', '-b:v', '200k', '-c:a', 'libopus', ...M, `${DIR}video.webm`);
ff(...V, '-c:v', 'mpeg4', '-c:a', 'libmp3lame', ...M, `${DIR}video.avi`);
ff(...A, '-c:a', 'libmp3lame', '-id3v2_version', '3', ...M, `${DIR}audio.mp3`);
ff(...A, ...M, `${DIR}audio.flac`);
ff(...A, ...M, `${DIR}audio.wav`);
ff(...A, '-c:a', 'libopus', ...M, `${DIR}audio.opus`);
ff(...A, '-c:a', 'aac', `${TMP}a.m4a`);
await tag(`${TMP}a.m4a`, `${DIR}audio.m4a`, [['ItemList:Artist', 'Ivan Petrov'], ['ItemList:Title', 'UNMETASECRET'], ['QuickTime:CreateDate', '2025:05:03 14:35:22']]);

// --- PDF: Info + XMP + embedded photo with GPS + annotation author
const pdf = await PDFDocument.create();
const page = pdf.addPage([400, 300]);
page.drawText('Unmeta test', { x: 40, y: 250, size: 18, font: await pdf.embedFont(StandardFonts.Helvetica) });
const jpg = await pdf.embedJpg(readFileSync(`${DIR}photo.jpg`));
page.drawImage(jpg, { x: 40, y: 40, width: 160, height: 120 });
pdf.setAuthor('Ivan Petrov'); pdf.setCreator('Microsoft Word'); pdf.setProducer('SecretPDF'); pdf.setTitle('UNMETASECRET');
pdf.setCreationDate(new Date('2025-05-03T14:35:22Z'));
const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator><rdf:Seq><rdf:li>Ivan Petrov UNMETASECRET</rdf:li></rdf:Seq></dc:creator></rdf:Description></rdf:RDF></x:xmpmeta>';
pdf.catalog.set(PDFName.of('Metadata'), pdf.context.register(pdf.context.flateStream(xmp, { Type: 'Metadata', Subtype: 'XML' })));
const annot = pdf.context.obj({ Type: 'Annot', Subtype: 'Text', Rect: [10, 10, 30, 30], T: 'Ivan Petrov', Contents: 'note', M: 'D:20250503143522Z' });
page.node.set(PDFName.of('Annots'), pdf.context.obj([pdf.context.register(annot)]));
writeFileSync(`${DIR}doc.pdf`, await pdf.save({ useObjectStreams: true }));

// --- DOCX (minimal valid WordprocessingML) with author, company, custom props, comment, tracked change, rsids, photo
const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const docx = {
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/><Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>`),
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`),
  'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.jpeg"/></Relationships>`),
  'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body><w:p w:rsidR="00AB12CD" w:rsidRDefault="00AB12CD"><w:r><w:t>Hello</w:t></w:r><w:ins w:id="1" w:author="Ivan Petrov" w:date="2025-05-03T14:35:22Z"><w:r><w:t> world</w:t></w:r></w:ins><w:commentRangeStart w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p></w:body></w:document>`),
  'word/comments.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:comments ${W}><w:comment w:id="0" w:author="Ivan Petrov" w:initials="IP" w:date="2025-05-03T14:35:22Z"><w:p><w:r><w:t>check</w:t></w:r></w:p></w:comment></w:comments>`),
  'word/settings.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:settings ${W}><w:rsids><w:rsidRoot w:val="00AB12CD"/><w:rsid w:val="00AB12CD"/></w:rsids></w:settings>`),
  'word/media/image1.jpeg': readFileSync(`${DIR}photo.jpg`),
  'docProps/core.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>UNMETASECRET</dc:title><dc:creator>Ivan Petrov</dc:creator><cp:lastModifiedBy>Ivan Petrov</cp:lastModifiedBy><cp:revision>7</cp:revision><dcterms:created xsi:type="dcterms:W3CDTF">2025-05-03T14:35:22Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2025-05-04T10:00:00Z</dcterms:modified></cp:coreProperties>`),
  'docProps/app.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Office Word</Application><Company>UNMETASECRET LLC</Company><Manager>Ivan Petrov</Manager><TotalTime>42</TotalTime></Properties>`),
  'docProps/custom.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="2" name="Client"><vt:lpwstr>UNMETASECRET</vt:lpwstr></property></Properties>`),
};
writeFileSync(`${DIR}doc.docx`, zipSync(docx, { mtime: new Date('2025-05-03T14:35:22Z') }));

// --- ODT (minimal) with meta + picture
const odt = {
  mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
  'META-INF/manifest.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3"><manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/><manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="Pictures/photo.jpg" manifest:media-type="image/jpeg"/></manifest:manifest>'),
  'content.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" office:version="1.3"><office:body><office:text><text:p>Hello</text:p></office:text></office:body></office:document-content>'),
  'meta.xml': strToU8('<?xml version="1.0" encoding="UTF-8"?><office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:dc="http://purl.org/dc/elements/1.1/" office:version="1.3"><office:meta><meta:generator>LibreOffice/7.6 UNMETASECRET</meta:generator><meta:initial-creator>Ivan Petrov</meta:initial-creator><dc:creator>Ivan Petrov</dc:creator><meta:creation-date>2025-05-03T14:35:22</meta:creation-date><dc:date>2025-05-04T10:00:00</dc:date><dc:title>UNMETASECRET</dc:title></office:meta></office:document-meta>'),
  'Pictures/photo.jpg': readFileSync(`${DIR}photo.jpg`),
};
writeFileSync(`${DIR}doc.odt`, zipSync(odt, { mtime: new Date('2025-05-03T14:35:22Z') }));

// --- SVG, text, unknown
writeFileSync(`${DIR}drawing.svg`, `<?xml version="1.0"?>
<!-- Created by Ivan Petrov UNMETASECRET -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:dc="http://purl.org/dc/elements/1.1/" width="10" height="10" inkscape:version="1.3" sodipodi:docname="/Users/ivan/UNMETASECRET/drawing.svg">
<title>UNMETASECRET</title>
<metadata><rdf:RDF><rdf:Description><dc:creator>Ivan Petrov</dc:creator></rdf:Description></rdf:RDF></metadata>
<sodipodi:namedview id="nv" inkscape:zoom="1"/>
<rect width="10" height="10" fill="red"/>
</svg>
`);
writeFileSync(`${DIR}notes.txt`, 'just some text\n');
writeFileSync(`${DIR}scene.blend`, Buffer.from('BLENDER-v300' + '\0'.repeat(52)));
rmSync(TMP, { recursive: true, force: true });
console.log(execFileSync('ls', ['-la', DIR]).toString());
