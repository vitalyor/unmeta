// Nasty inputs for the stress run → ~/Downloads/unmeta-stress/fuzz + manifest-fuzz.json. All metadata is fake.
// Run: node stress/make-fuzz.mjs
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, statSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
import { PDFDocument } from 'pdf-lib';
import { zipSync, strToU8, unzipSync } from 'fflate';

const OUT = join(homedir(), 'Downloads', 'unmeta-stress');
const DIR = join(OUT, 'fuzz');
rmSync(DIR, { recursive: true, force: true }); mkdirSync(DIR, { recursive: true });
const FX = 'test/fixtures', SM = 'test/samples';
const ff = (...a) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...a]);
const w = (name, data) => writeFileSync(join(DIR, name), data);
let rnd = 12345; const rand = () => ((rnd = (rnd * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);

const fs = new MemoryFileSystem({ '/': '' });
const perl = await ZeroPerl.create({ fileSystem: fs });
await perl.eval('use Image::ExifTool;');
const GPS = [['GPSLatitude', 55.7558], ['GPSLatitudeRef', 'N'], ['GPSLongitude', 37.6173], ['GPSLongitudeRef', 'E'], ['Artist', 'Ivan Petrov FUZZSECRET'], ['Model', 'FuzzCam 3000']];
async function tag(bytes, tags, extra = '') {
  fs.addFile('/s', bytes);
  const set = tags.map(([k, v]) => `$et->SetNewValue('${k}', '${String(v).replace(/'/g, "\\'")}');`).join('');
  const r = await perl.eval(`my $et = Image::ExifTool->new; ${set} ${extra} unlink '/d'; $et->WriteInfo('/s', '/d') or die $et->GetValue('Error');`);
  if (!r.success) throw new Error(perl.getLastError());
  const out = fs.lookup('/d').content; fs.removeFile('/s'); fs.removeFile('/d'); return Buffer.from(out);
}

// 1. broken / truncated / flipped
const seeds = ['photo.jpg', 'photo.png', 'photo.heic', 'photo.tif', 'video.mp4', 'video.mov', 'video.mkv', 'audio.mp3', 'audio.flac', 'doc.pdf', 'doc.docx', 'doc.odt'];
for (const s of seeds) {
  const b = readFileSync(join(FX, s));
  for (const p of [0.05, 0.5, 0.95]) w(`trunc${Math.round(p * 100)}_${s}`, b.subarray(0, Math.floor(b.length * p)));
  w(`head64_${s}`, b.subarray(0, 64));
  const f = Buffer.from(b); for (let k = 0; k < 60; k++) f[Math.floor(f.length * 0.2 + rand() * f.length * 0.6)] ^= 0xff; w(`flip_${s}`, f);
}
for (const s of ['canon-r5.cr3', 'iphone12pro.dng']) { try { const b = readFileSync(join(SM, s)); w(`trunc50_${s}`, b.subarray(0, b.length / 2)); } catch { /* samples not fetched */ } }
w('empty.jpg', Buffer.alloc(0)); w('one-byte.pdf', Buffer.from('%')); w('zeros.mp4', Buffer.alloc(4096));

// 2. disguised / names
const jpg = readFileSync(join(FX, 'photo.jpg'));
w('photo-really-a-jpeg.pdf', jpg); w('doc-really-a-pdf.jpg', readFileSync(join(FX, 'doc.pdf'))); w('video-really-mp4.mp3', readFileSync(join(FX, 'video.mp4')));
w('text-pretending.jpg', Buffer.from('hello, I am text\n')); w('no-extension', jpg); w('UPPER.JPEG', jpg); w('my.holiday.final.v2.JPG', jpg);
w('🐶 собака 照片 تصوير.jpg', jpg); w(`${'очень_длинное_имя_'.repeat(11)}.jpg`, jpg); w('  spaces  around  .jpg', jpg);

// 3. bombs and volume
const big = 'x'.repeat(100 * 2 ** 20);
w('bomb-100mb-xml.docx', zipSync({ ...unzipSync(readFileSync(join(FX, 'doc.docx'))), 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${big}</w:t></w:r></w:p></w:body></w:document>`) }, { level: 9 }));
const pdf = await PDFDocument.create(); const im = await pdf.embedJpg(await tag(jpg, GPS));
for (let k = 0; k < 100; k++) { const pg = pdf.addPage([200, 150]); pg.drawImage(k % 2 ? im : await pdf.embedJpg(await tag(jpg, [...GPS, ['ImageDescription', `photo ${k} FUZZSECRET`]])), { x: 0, y: 0, width: 200, height: 150 }); }
pdf.setAuthor('Ivan Petrov FUZZSECRET'); w('100-photos-with-gps.pdf', await pdf.save());
const png = readFileSync(join(FX, 'photo.png'));
{ // PNG with 1000 tEXt chunks before IEND
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const iend = png.length - 12;
  const texts = Array.from({ length: 1000 }, (_, k) => chunk('tEXt', Buffer.from(`Comment\0FUZZSECRET note ${k}`)));
  w('1000-text-chunks.png', Buffer.concat([png.subarray(0, iend), ...texts, png.subarray(iend)]));
}
w('huge-exif-and-xmp.jpg', await tag(jpg, [...GPS, ['XMP-dc:Description', 'FUZZSECRET ' + 'lorem ipsum '.repeat(12000)], ['UserComment', 'FUZZSECRET ' + 'z'.repeat(60000)]]));

// 4. hidden places
const cover = await tag(jpg, GPS);
writeFileSync('/tmp/unmeta-cover.jpg', cover);
const A = ['-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100', '-t', '1'];
ff(...A, '-i', '/tmp/unmeta-cover.jpg', '-map', '0', '-map', '1', '-c:a', 'libmp3lame', '-c:v', 'copy', '-id3v2_version', '3', '-disposition:v', 'attached_pic', '-metadata', 'artist=Ivan Petrov FUZZSECRET', '-t', '1', join(DIR, 'cover-with-gps.mp3'));
ff(...A, '-i', '/tmp/unmeta-cover.jpg', '-map', '0', '-map', '1', '-c:a', 'flac', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-t', '1', join(DIR, 'cover-with-gps.flac'));
ff(...A, '-i', '/tmp/unmeta-cover.jpg', '-map', '0', '-map', '1', '-c:a', 'aac', '-c:v', 'copy', '-disposition:v', 'attached_pic', '-t', '1', join(DIR, 'cover-with-gps.m4a'));
writeFileSync('/tmp/unmeta-subs.srt', '1\n00:00:00,000 --> 00:00:01,000\nGPS 55.7558 37.6173 FUZZSECRET\n');
const V = ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=15', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '2'];
ff(...V, '-i', '/tmp/unmeta-subs.srt', '-map', '0', '-map', '1', '-map', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-c:s', 'mov_text', '-t', '2', join(DIR, 'drone-subtitle-gps.mp4'));
ff(...V, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', 'frag_keyframe+empty_moov', '-metadata', 'artist=Ivan Petrov FUZZSECRET', join(DIR, 'fragmented.mp4'));
ff(...V, '-c:v', 'libx265', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'location=+55.7558+037.6173/', '-metadata', 'artist=Ivan Petrov FUZZSECRET', join(DIR, 'iphone-like-hevc.mov'));
ff(...V, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-movflags', '+faststart', '-metadata', 'comment=FUZZSECRET', join(DIR, 'faststart.mp4'));
ff(...V, '-attach', '/tmp/unmeta-cover.jpg', '-metadata:s:t', 'mimetype=image/jpeg', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '2', join(DIR, 'attachment-with-gps.mkv'));

// 5. real-world-ish formats from the corpus with injected metadata
for (const [name, src] of [['webp-with-exif.webp', 'design/mockups/photos/cat.jpg']]) {
  try { ff('-i', src, '-c:v', 'libwebp', join(DIR, 'tmp.webp')); w(name, await tag(readFileSync(join(DIR, 'tmp.webp')), GPS)); rmSync(join(DIR, 'tmp.webp')); }
  catch { /* no libwebp encoder */ }
}
ff('-i', 'design/mockups/photos/cat.jpg', '-frames:v', '1', join(DIR, 'tmp.avif')).toString?.();
try { w('avif-with-exif.avif', await tag(readFileSync(join(DIR, 'tmp.avif')), GPS)); rmSync(join(DIR, 'tmp.avif')); } catch (e) { console.log('avif:', String(e).slice(0, 80)); }

// manifest
const files = readdirSync(DIR).sort();
const man = files.map((name, i) => ({ i, ext: (name.includes('.') ? name.split('.').pop() : '').toLowerCase(), size: statSync(join(DIR, name)).size, path: join(DIR, name), why: 'fuzz' }));
writeFileSync(join(OUT, 'manifest-fuzz.json'), JSON.stringify(man, null, 0));
console.log(man.length, 'fuzz files');
