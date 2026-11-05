// One long-lived Perl (zeroperl) with Image::ExifTool loaded once.
// Spawning exiftool per file costs ~0.8 s (script compile); calling the API costs ~10–25 ms.
import { ZeroPerl, MemoryFileSystem } from '@6over3/zeroperl-ts';
import type { Category, Tag } from './categories';

// Tags restored after "delete everything", per kept category (family-2 groups where ExifTool has them).
const RESTORE: Record<Exclude<Category, 'filename'>, string[]> = {
  location: ['Location:all'],
  device: ['Camera:all', 'Device:all', 'MakerNotes:all'],
  author: ['Author:all'],
  software: ['Software', 'CreatorTool', 'ProcessingSoftware', 'HostComputer', 'XMP-xmpMM:all', 'XMP-photoshop:History'],
  thumbnails: ['Preview:all'],
  // 'Time:all' restores nothing here (it drags in System file times), so list them.
  dates: ['DateTimeOriginal', 'CreateDate', 'ModifyDate', 'SubSecTime', 'SubSecTimeOriginal', 'SubSecTimeDigitized',
    'OffsetTime', 'OffsetTimeOriginal', 'OffsetTimeDigitized', 'XMP-xmp:CreateDate', 'XMP-xmp:ModifyDate', 'XMP-xmp:MetadataDate',
    'XMP-photoshop:DateCreated', 'XMP-exif:DateTimeOriginal', 'IPTC:DateCreated', 'IPTC:TimeCreated', 'PNG:CreationTime'],
  descriptions: ['ImageDescription', 'XMP-dc:Title', 'XMP-dc:Description', 'XMP-dc:Subject', 'Keywords', 'Caption-Abstract',
    'Headline', 'UserComment', 'XPComment', 'XPTitle', 'XPSubject', 'XPKeywords', 'Comment', 'Rating'],
  c2pa: ['JUMBF:all'],
};
const ALWAYS_KEEP = ['Orientation', 'ICC_Profile'];
// TIFF stores image structure in IFD0, so "delete all" leaves these text tags behind.
const TIFF_IFD0 = ['ImageDescription', 'Make', 'Model', 'Software', 'Artist', 'Copyright', 'ModifyDate', 'HostComputer',
  'DocumentName', 'PageName', 'XPTitle', 'XPComment', 'XPAuthor', 'XPKeywords', 'XPSubject'];

const PERL = String.raw`
use strict; use warnings;
use Image::ExifTool;
use JSON::PP;
my $json = JSON::PP->new->utf8->canonical;
sub um_read {
  my ($src) = @_;
  my $et = Image::ExifTool->new;
  $et->Options(Duplicates => 1, Binary => 0, Unknown => 0, LargeFileSupport => 1);
  my $info = $et->ImageInfo($src);
  my @tags;
  for my $key (keys %$info) {
    my @g = $et->GetGroup($key);
    next if ($g[0] =~ /^(ExifTool|File|Composite)$/ or $g[1] eq 'System') and $key ne 'Rotation';
    my $v = $info->{$key};
    $v = ref $v eq 'SCALAR' ? '(binary)' : ref $v eq 'ARRAY' ? join(', ', @$v) : $v;
    (my $name = $key) =~ s/ \(\d+\)$//;
    push @tags, { group0 => $g[0], group1 => $g[1], group2 => $g[2], name => $name, value => substr("$v", 0, 200) };
  }
  return $json->encode({ tags => \@tags, error => $info->{Error} // '' });
}
# $mode: image | tiff. $del / $keep / $excl: comma-separated tag specs / groups. (RAW uses um_scrub.)
sub um_clean {
  my ($src, $dst, $mode, $del, $keep, $excl) = @_;
  my $et = Image::ExifTool->new;
  $et->Options(IgnoreMinorErrors => 1, LargeFileSupport => 1);
  {
    $et->SetNewValue('*');
    # "delete all except": groups that can't be copied back (e.g. JUMBF/C2PA) are excluded from the delete
    $et->SetNewValue("$_:*", undef, Replace => 2) for grep length, split /,/, $excl;
    $et->SetNewValue($_) for grep length, split /,/, $del;
    my @keep = grep length, split /,/, $keep;
    $et->SetNewValuesFromFile($src, @keep) if @keep;
  }
  my $ok = $et->WriteInfo($src, $dst);
  return $ok ? '' : ($et->GetValue('Error') || 'write failed');
}
# Second pass for RAW: remove exactly the leftover tags. MakerNote tags often can't be deleted
# ("permanent"), so those get a neutral value instead (empty text / zero date).
sub um_scrub {
  my ($src, $dst, $specs) = @_;
  my $et = Image::ExifTool->new;
  $et->Options(IgnoreMinorErrors => 1, LargeFileSupport => 1);
  for my $s (grep length, split /\n/, $specs) {
    my ($tag, $kind) = split /\t/, $s;
    my ($n) = $et->SetNewValue($tag);
    next if $n;
    ($n) = $et->SetNewValue($tag, $kind eq 'date' ? '0000:00:00 00:00:00' : ' ', Protected => 1);
    next if $n;
    $et->SetNewValue("$tag#", 0, Protected => 1); # list-valued tags (e.g. Canon TimeZoneCity): 0 = "n/a"

  }
  my $ok = $et->WriteInfo($src, $dst);
  return $ok ? '' : ($et->GetValue('Error') || 'write failed');
}
1;
`;

export class Perl {
  private fs = new MemoryFileSystem({ '/': '' });
  private out = '';
  private err = '';
  private perl!: ZeroPerl;
  private n = 0;

  static async create(fetchWasm?: () => Promise<Response>): Promise<Perl> {
    const p = new Perl();
    const dec = new TextDecoder();
    const text = (s: string | Uint8Array) => (typeof s === 'string' ? s : dec.decode(s));
    p.perl = await ZeroPerl.create({
      fileSystem: p.fs,
      stdout: (s: string | Uint8Array) => { p.out += text(s); },
      stderr: (s: string | Uint8Array) => { p.err += text(s); },
      ...(fetchWasm ? { fetch: fetchWasm } : {}),
    } as Parameters<typeof ZeroPerl.create>[0]);
    await p.call(PERL);
    return p;
  }

  private async call(code: string): Promise<string> {
    this.out = ''; this.err = '';
    const r = await this.perl.eval(code);
    this.perl.flush();
    if (!r.success) throw new Error(this.err || this.perl.getLastError() || 'perl error');
    return this.out;
  }

  private path(name: string) {
    const safe = name.replace(/[^\w.-]/g, '_').slice(-60);
    return `/f${++this.n}_${safe}`;
  }

  async read(name: string, data: Blob | Uint8Array): Promise<{ tags: Tag[]; error: string }> {
    const src = this.path(name);
    this.fs.addFile(src, data);
    try { return JSON.parse(await this.call(`print um_read(${q(src)});`)); }
    finally { this.rm(src); }
  }

  /** Returns cleaned bytes. `keep` = categories the user keeps. */
  async clean(name: string, data: Blob | Uint8Array, mode: 'image' | 'tiff', keep: Category[]): Promise<Uint8Array> {
    const src = this.path(name), dst = this.path('out_' + name);
    const kept = keep.filter((c): c is Exclude<Category, 'filename'> => c !== 'filename');
    const del = mode === 'tiff' ? TIFF_IFD0 : [];
    const restore = [...ALWAYS_KEEP, ...kept.flatMap((c) => RESTORE[c])];
    this.fs.addFile(src, data);
    try {
      const excl = kept.includes('c2pa') ? ['JUMBF'] : [];
      const e = await this.call(`print um_clean(${q(src)}, ${q(dst)}, ${q(mode)}, ${q(del.join(','))}, ${q(restore.join(','))}, ${q(excl.join(','))});`);
      if (e) throw new Error(e);
      return await this.output(dst);
    } finally { this.rm(src); this.rm(dst); }
  }

  /**
   * Remove (or neutralize) exactly these tags. Used for RAW, where wholesale deletes break files
   * (decoders need MakerNotes/Make/Model/previews; even deleting a GPS block kills a Canon CR3).
   */
  async scrub(name: string, data: Blob | Uint8Array, tags: Tag[]): Promise<Uint8Array> {
    const src = this.path(name), dst = this.path('out_' + name);
    const specs = tags.map((t) => `${t.group1}:${t.name}\t${/date|time/i.test(t.name) ? 'date' : 'text'}`).join('\n');
    this.fs.addFile(src, data);
    try {
      const e = await this.call(`print um_scrub(${q(src)}, ${q(dst)}, ${q(specs)});`);
      if (e) throw new Error(e);
      return await this.output(dst);
    } finally { this.rm(src); this.rm(dst); }
  }

  private async output(dst: string): Promise<Uint8Array> {
    const node = this.fs.lookup(dst) as { content: Uint8Array | Blob } | null;
    if (!node) throw new Error('no output');
    return node.content instanceof Blob ? new Uint8Array(await node.content.arrayBuffer()) : node.content.slice();
  }

  private rm(p: string) { try { this.fs.removeFile(p); } catch { /* not created */ } }
}

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
