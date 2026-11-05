// Strings live in copy/ru.json + copy/en.json. Tiny ICU subset: {arg}, plural (with =N and #), select.
import ru from '../../copy/ru.json';
import en from '../../copy/en.json';

const COPY = { ru, en } as const;
export type Lang = keyof typeof COPY;
type Params = Record<string, string | number>;

const saved = localStorage.getItem('um-lang') as Lang | null;
export const i18n = $state({ lang: (saved ?? (navigator.language.startsWith('ru') ? 'ru' : 'en')) as Lang });

export function setLang(l: Lang) {
  i18n.lang = l;
  localStorage.setItem('um-lang', l);
  document.documentElement.lang = l;
}

const close = (s: string, i: number) => {
  let d = 0;
  for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return j; }
  return s.length;
};
function fmt(s: string, p: Params, lang: Lang): string {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '{') { const j = close(s, i); out += arg(s.slice(i + 1, j), p, lang); i = j + 1; }
    else out += s[i++];
  }
  return out;
}
function arg(inner: string, p: Params, lang: Lang): string {
  const c1 = inner.indexOf(',');
  if (c1 < 0) return String(p[inner.trim()] ?? '');
  const name = inner.slice(0, c1).trim(), rest = inner.slice(c1 + 1), c2 = rest.indexOf(',');
  const type = rest.slice(0, c2).trim(), body = rest.slice(c2 + 1), opts: Record<string, string> = {};
  for (let i = 0; i < body.length;) {
    const b = body.indexOf('{', i); if (b < 0) break;
    const key = body.slice(i, b).trim(), e = close(body, b);
    opts[key] = body.slice(b + 1, e); i = e + 1;
  }
  const v = p[name];
  if (type === 'plural') {
    const k = opts['=' + v] != null ? '=' + v : new Intl.PluralRules(lang).select(Number(v));
    return fmt((opts[k] ?? opts.other).replace(/#/g, String(v)), p, lang);
  }
  return fmt(opts[String(v)] ?? opts.other ?? '', p, lang);
}
// Russian typography: short words (в, о, и, на, не…) never end a line.
const glue = (s: string, lang: Lang) =>
  lang === 'ru' ? s.replace(/(^|[\s(«])([а-яё]{1,2})\s/gi, '$1$2 ').replace(/(^|[\s(«])([а-яё]{1,2})\s/gi, '$1$2 ') : s;

export function t(key: string, p: Params = {}): string {
  const lang = i18n.lang;
  const s = key.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], COPY[lang]);
  return typeof s === 'string' ? glue(fmt(s, p, lang), lang) : key;
}

export function size(bytes: number): string {
  const u = i18n.lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let b = bytes, i = 0;
  while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return new Intl.NumberFormat(i18n.lang, { maximumFractionDigits: b < 10 && i ? 1 : 0 }).format(b) + ' ' + u[i];
}
