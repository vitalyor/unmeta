// What the user can keep or remove. Order = order in the UI.
export const CATEGORIES = [
  'location', 'device', 'author', 'software', 'thumbnails', 'dates', 'descriptions', 'c2pa', 'filename',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type PresetId = 'max' | 'balanced' | 'private';
// Categories each preset KEEPS (everything else is removed). Orientation/ICC/video rotation are always kept.
export const PRESETS: Record<PresetId, Category[]> = {
  max: [],
  balanced: ['dates', 'descriptions', 'c2pa', 'filename'],
  private: ['author', 'software', 'thumbnails', 'dates', 'descriptions', 'c2pa', 'filename'],
};

export interface Tag { group0: string; group1: string; group2: string; name: string; value: string }

const SOFTWARE = /^(Software|CreatorTool|ProcessingSoftware|History.*|Producer|Encoder|EncodedBy|encoder|encoded_by|Application|AppVersion|Generator|Template|TotalTime|EditingDuration|EditingCycles|RevisionNumber|Revision|HistorySoftwareAgent|DerivedFrom.*|DocumentID|InstanceID|OriginalDocumentID|com\.apple\.quicktime\.software)$/i;
const DESCRIPTION = /^(ImageDescription|Title|Description|Caption.*|Headline|Keywords?|Subject|UserComment|Comment|XP(Comment|Title|Subject|Keywords)|Rating.*|Label|Category|SupplementalCategories|Instructions|Notes|Lyrics|Album|Genre|Synopsis|ContentStatus)$/i;
// Fallbacks by name for sources without family-2 groups (ffmpeg metadata dump, Office XML).
const AUTHOR = /^(Artist|Author|Creator|By-?line|Copyright|Rights|LastModifiedBy|InitialCreator|PrintedBy|Company|Manager|Owner.*|Publisher|Album_?Artist|Composer|Performer|Writer|CommentAuthor|RevisionAuthor|CustomProperty|com\.apple\.quicktime\.author)$/i;
const LOCATION = /^(location.*|.*GPS.*|com\.apple\.quicktime\.location.*)$/i;
const DEVICE = /^(Make|Model|com\.apple\.quicktime\.(make|model)|PrinterName|PrinterSetup)$/i;
const DATE = /(date|time)$/i;
// "No date": zeroed QuickTime times and the DOS zip epoch we write into cleaned Office files.
const ZERO_DATE = /^(0000:00:00 00:00:00|1980:01:01 00:00:00)/;

/** Map one ExifTool tag to a user-facing category, or null if it reveals nothing (structure, codec, size). */
export function classify(t: Tag): Exclude<Category, 'filename'> | null {
  // empty / zeroed fields reveal nothing
  if (!t.value.trim() || /^(n\/a|none|unknown|off|false|no)$/i.test(t.value.trim()) || (/^0( \(Unrated\))?$/.test(t.value) && /^Rating/.test(t.name)) || (/Serial/i.test(t.name) && /^[0\s]+$/.test(t.value))) return null;
  // cover art is content (we keep it, cleaned); ffmpeg labels the cover stream "Cover (front)"
  if (/^(Picture|CoverArt|APIC|Cover)$/i.test(t.name) || /^Cover \((front|back)\)$|^Other$/i.test(t.value)) return null;
  // colour profile is kept on purpose (colours); its "device"/"date" fields describe the profile, e.g. sRGB 1998
  if (/^ICC/.test(t.group0) || /^ICC/.test(t.group1)) return null;
  // format version, not a place; deleting it from a Canon CR3 makes the whole file unreadable
  if (t.name === 'GPSVersionID') return null;
  if (/TimeZoneCity|HomeTown|WorldTime(Location)?City/i.test(t.name)) return 'location';
  if (/^(JUMBF|C2PA)$/i.test(t.group0) || /^(JUMBF|C2PA)/i.test(t.group1)) return 'c2pa';
  if (/^(Lav[fc]|LAME|Lavu)[\d.]*(\s|$)/.test(t.value)) return null; // encoder library versions inside the stream itself, identify nobody // ffmpeg's own generic tag (our remuxer), identifies nobody
  if (t.group1 === 'PDF' && t.name === 'Creator') return 'software'; // PDF "Creator" = the app, not the person
  if (SOFTWARE.test(t.name)) return 'software';
  switch (t.group2) {
    case 'Location': return 'location';
    case 'Camera': case 'Device': return 'device';
    // settings like DaylightSavings=Off or DateDisplayFormat=Y/M/D are not dates
    case 'Time': return ZERO_DATE.test(t.value) || !/\d{4}[:-]\d\d[:-]\d\d|^[+-]\d\d:\d\d$/.test(t.value) ? null : 'dates';
    case 'Author': return 'author';
    case 'Preview': return 'thumbnails';
  }
  if (t.group0 === 'MakerNotes') return 'device';
  if (DESCRIPTION.test(t.name)) return 'descriptions';
  if (AUTHOR.test(t.name)) return 'author';
  if (LOCATION.test(t.name)) return 'location';
  if (DEVICE.test(t.name)) return 'device';
  if (t.group0 === 'ffmpeg' || t.group0 === 'Office') {
    if (DATE.test(t.name) && !/duration/i.test(t.name)) return ZERO_DATE.test(t.value) || /^1970-01-01T00:00:00/.test(t.value) ? null : 'dates';
  }
  return null;
}
