// public/example.jpg: the "try with a sample" photo (Unsplash, see design/mockups/photos/CREDITS.md)
// with FAKE metadata that matches the start-screen label in copy/*.json. Run: node test/make-example.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
const fs = new MemoryFileSystem({ '/': '' });
const perl = await ZeroPerl.create({ fileSystem: fs });
fs.addFile('/in.jpg', readFileSync('design/mockups/photos/dog.jpg'));
const tags = [['GPSLatitude', 55.7522], ['GPSLatitudeRef', 'N'], ['GPSLongitude', 37.6156], ['GPSLongitudeRef', 'E'], ['GPSAltitude', 156.2],
  ['Make', 'Apple'], ['Model', 'iPhone 15 Pro'], ['LensModel', 'iPhone 15 Pro back triple camera 6.86mm f/1.78'], ['LensSerialNumber', 'F7A39C1D'],
  ['DateTimeOriginal', '2026:05:12 18:42:07'], ['CreateDate', '2026:05:12 18:42:07'], ['OffsetTimeOriginal', '+03:00'],
  ['Artist', 'Anna K.'], ['XMP-dc:Creator', 'Anna K.'], ['Software', '19.1'], ['XMP-xmp:CreatorTool', 'Photos 19.1'],
  ['XMP-dc:Description', 'Dacha, May'], ['Orientation#', 1]];
const set = tags.map(([k, v]) => `$et->SetNewValue('${k}', '${v}');`).join('');
const r = await perl.eval(`use Image::ExifTool; my $et = Image::ExifTool->new; ${set} $et->WriteInfo('/in.jpg', '/out.jpg') or die $et->GetValue('Error');`);
if (!r.success) throw new Error(perl.getLastError());
writeFileSync('public/example.jpg', fs.lookup('/out.jpg').content);
console.log('public/example.jpg written');
