// SVG is text: editors leave RDF metadata, comments, original file paths (sodipodi:docname) and app versions.
import type { Category } from './categories';

export function cleanSvg(src: string, keep: Category[]): string {
  let s = src
    .replace(/<metadata\b[\s\S]*?<\/metadata>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<sodipodi:namedview\b[\s\S]*?(\/>|<\/sodipodi:namedview>)/gi, '')
    .replace(/\s(inkscape|sodipodi|sketch|serif|xmlns:(inkscape|sodipodi|sketch|serif|rdf|cc|dc)):?[\w-]*="[^"]*"/gi, '')
    .replace(/<\?xml-stylesheet[^>]*\?>/g, '');
  if (!keep.includes('descriptions')) s = s.replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  return s;
}
