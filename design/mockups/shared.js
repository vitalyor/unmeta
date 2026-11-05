/* Unmeta mockups — shared demo engine.
   Same flow, data and copy for every direction; each direction supplies its own CSS
   (and optional hooks in window.DIR). Copy comes from copy.js (snapshot of /copy).
   URL params: ?screen=start|report|modes|after|batch|unsupported|large|largeProgress
               &theme=light|dark &lang=ru|en &ui=0 (hide mockup toolbar) &still=1 (skip intro motion) */
(() => {
'use strict';
const $ = (s, r = document) => r.querySelector(s);
const qs = new URLSearchParams(location.search);
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const STILL = qs.get('still') === '1';
const DIR = window.DIR || {};

/* ---------- copy + tiny ICU (plural/select/args) ---------- */
let lang = qs.get('lang') || (localStorage.getItem('um-lang')) || (navigator.language.startsWith('ru') ? 'ru' : 'en');
const close = (s, i) => { let d = 0; for (let j = i; j < s.length; j++) { if (s[j] === '{') d++; else if (s[j] === '}' && --d === 0) return j; } return s.length; };
function fmt(s, p) {
  let out = '', i = 0;
  while (i < s.length) {
    if (s[i] === '{') { const j = close(s, i); out += arg(s.slice(i + 1, j), p); i = j + 1; }
    else out += s[i++];
  }
  return out;
}
function arg(inner, p) {
  const c1 = inner.indexOf(',');
  if (c1 < 0) return p[inner.trim()] ?? '';
  const name = inner.slice(0, c1).trim(), rest = inner.slice(c1 + 1), c2 = rest.indexOf(',');
  const type = rest.slice(0, c2).trim(), body = rest.slice(c2 + 1), opts = {};
  for (let i = 0; i < body.length;) {
    const b = body.indexOf('{', i); if (b < 0) break;
    const key = body.slice(i, b).trim(), e = close(body, b);
    opts[key] = body.slice(b + 1, e); i = e + 1;
  }
  const v = p[name];
  if (type === 'plural') {
    const k = opts['=' + v] != null ? '=' + v : new Intl.PluralRules(lang).select(v);
    return fmt((opts[k] ?? opts.other).replace(/#/g, v), p);
  }
  return fmt(opts[v] ?? opts.other ?? '', p);
}
// Russian typography: short words (в, о, и, на, не…) never end a line.
const glue = (s) => (lang === 'ru' ? s.replace(/(^|[\s(«])([а-яё]{1,2})\s/gi, '$1$2\u00a0').replace(/(^|[\s(«])([а-яё]{1,2})\s/gi, '$1$2\u00a0') : s);
const t = (key, p = {}) => { const s = key.split('.').reduce((o, k) => o?.[k], COPY[lang]); return s == null ? key : glue(fmt(s, p)); };

/* Mockup-only strings (demo values, toolbar). Not product copy. */
const M = {
  ru: { screens: 'Экраны', s: { start: 'Старт', report: 'Отчёт', modes: 'Режим', after: 'Было / стало', batch: 'Пакет', unsupported: 'Отказ', large: 'Большой файл' },
        mock: 'Макет', demo: 'Попробовать на примере', more: 'ещё {n}', left: 'осталось ~{s} с', of: '{a} из {b}',
        exportTip: 'Совет: сохраните презентацию как PDF — его мы очистим.', chooseOther: 'Выбрать другой файл', multiMobile: 'Можно отметить сразу несколько фото и видео', pickFiles: 'Документы и другие файлы', pickMedia: 'Выбрать фото и видео', phone: 'на этом телефоне',
        willRemove: 'Будет удалено', willKeep: 'Останется', found: 'Нашли', nothing: 'Не нашли', saved: 'Сохранено', zip: 'ZIP, {size}',
        short: { location: 'Геопозиция', device: 'Устройство', dates: 'Даты', author: 'Автор', software: 'Программы', thumbnails: 'Превью', descriptions: 'Подписи', c2pa: 'C2PA', filename: 'Имя файла' },
        cats: 'категорий', tags: 'Поля в файле', theme: 'Сменить тему', langBtn: 'English', cleanAll: 'Очистить всё' },
  en: { screens: 'Screens', s: { start: 'Start', report: 'Report', modes: 'Mode', after: 'Before / after', batch: 'Batch', unsupported: 'Unsupported', large: 'Large file' },
        mock: 'Mockup', demo: 'Try with a sample', more: '{n} more', left: '~{s}s left', of: '{a} of {b}',
        exportTip: 'Tip: save the presentation as a PDF — we can clean that.', chooseOther: 'Choose another file', multiMobile: 'You can tick several photos and videos at once', pickFiles: 'Documents and other files', pickMedia: 'Choose photos and videos', phone: 'on this phone',
        willRemove: 'Will be removed', willKeep: 'Stays', found: 'Found', nothing: 'Not found', saved: 'Saved', zip: 'ZIP, {size}',
        short: { location: 'Location', device: 'Device', dates: 'Dates', author: 'Author', software: 'Apps', thumbnails: 'Preview', descriptions: 'Captions', c2pa: 'C2PA', filename: 'File name' },
        cats: 'categories', tags: 'Fields in the file', theme: 'Switch theme', langBtn: 'Русский', cleanAll: 'Clean all' },
};
const m = (k, p = {}) => fmt(k.split('.').reduce((o, x) => o?.[x], M[lang]) ?? k, p);

/* ---------- domain ---------- */
const CATS = ['location', 'device', 'dates', 'author', 'software', 'thumbnails', 'descriptions', 'c2pa', 'filename'];
const MODES = {
  maximum:     new Set(CATS),
  balanced:    new Set(['location', 'device', 'author', 'software', 'thumbnails']),
  privateOnly: new Set(['location', 'device']),
};
const MODE_ICON = { maximum: 'shield', balanced: 'scale', privateOnly: 'location', custom: 'sliders' };

const ICON = {
  location: '<path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  device: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M11 18.5h2"/>',
  dates: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  author: '<circle cx="12" cy="8" r="3.5"/><path d="M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5"/>',
  software: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
  thumbnails: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.75"/><path d="M21 16l-5-5-8 9"/>',
  descriptions: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12h5"/>',
  c2pa: '<path d="M12 3l2.4 1.8 3-.2.9 2.9 2.4 1.8-1 2.8 1 2.8-2.4 1.8-.9 2.9-3-.2L12 21l-2.4-1.8-3 .2-.9-2.9-2.4-1.8 1-2.8-1-2.8 2.4-1.8.9-2.9 3 .2z"/><path d="M9 12l2 2 4-4"/>',
  filename: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="8.5" r="1.5"/>',
  shield: '<path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6z"/>',
  scale: '<path d="M12 4v16M8 20h8M5 7h14"/><path d="M5 7l-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z"/>',
  sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  eraser: '<path d="M7 21h13"/><path d="M4.6 15.4l9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8L13 19H8.2z"/><path d="M9 11l5 5"/>',
  upload: '<path d="M12 15V4M7.5 8.5L12 4l4.5 4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  share: '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M8 11H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  weight: '<path d="M6.5 8h11l2.5 12H4z"/><circle cx="12" cy="5.5" r="2.5"/>',
  lock: '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>',
};
const ic = (n, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[n] || ''}</svg>`;

/* Placeholder visuals for files — no images, no network. */
function thumb(kind, seed = 0) {
  const skies = [['#F7B98E', '#8A97D6'], ['#9CC9E6', '#3E6FA8'], ['#F3D2A2', '#C9786A'], ['#B9D7C5', '#5E8C86']];
  const [a, b] = skies[seed % skies.length];
  if (kind === 'photo' || kind === 'video') return `<svg class="thumb-art" viewBox="0 0 120 90" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><linearGradient id="g${seed}${kind}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${b}"/><stop offset="1" stop-color="${a}"/></linearGradient></defs>
    <rect width="120" height="90" fill="url(#g${seed}${kind})"/><circle cx="${78 - seed * 9}" cy="34" r="11" fill="#FFF1D6" opacity=".9"/>
    <path d="M0 64 Q30 46 58 60 T120 54 V90 H0z" fill="#3D4C6E" opacity=".85"/><path d="M0 74 Q40 60 76 72 T120 70 V90 H0z" fill="#23304B"/>
    ${kind === 'video' ? '<circle cx="60" cy="45" r="13" fill="rgba(0,0,0,.35)"/><path d="M56 38.5v13l10.5-6.5z" fill="#fff"/>' : ''}</svg>`;
  const glyph = { doc: 'W', pdf: 'PDF', audio: '', text: 'TXT', other: '?' }[kind] ?? '';
  if (kind === 'audio') return `<svg class="thumb-art thumb-file" viewBox="0 0 120 90" aria-hidden="true"><rect width="120" height="90" class="tf-bg"/>${[14, 28, 18, 40, 24, 34, 12, 30, 20].map((h, i) => `<rect x="${22 + i * 9}" y="${45 - h / 2}" width="4" height="${h}" rx="2" class="tf-ink"/>`).join('')}</svg>`;
  return `<svg class="thumb-art thumb-file" viewBox="0 0 120 90" aria-hidden="true"><rect width="120" height="90" class="tf-bg"/><path d="M44 14h24l12 12v50H44z" class="tf-page"/><path d="M68 14v12h12" class="tf-fold"/><text x="62" y="60" text-anchor="middle" class="tf-ink tf-text">${glyph}</text></svg>`;
}

window.UM_thumb = (k, n) => thumb(k, n);
const L = (ru, en) => (lang === 'ru' ? ru : en);
const size = (b) => {
  const u = lang === 'ru' ? ['Б', 'КБ', 'МБ', 'ГБ'] : ['B', 'KB', 'MB', 'GB'];
  let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; }
  return new Intl.NumberFormat(lang, { maximumFractionDigits: b < 10 && i ? 1 : 0 }).format(b) + ' ' + u[i];
};

/* Demo photo — what a typical iPhone shot carries. */
const PHOTO = () => ({
  name: 'IMG_4821.HEIC', bytes: 3.4 * 1048576, kind: 'photo', neutral: 'photo_01',
  found: {
    location: null,
    device: L('Apple iPhone 15 Pro · серийный номер объектива', 'Apple iPhone 15 Pro · lens serial number'),
    dates: L('12 мая 2026, 18:42:07', '12 May 2026, 6:42:07 PM'),
    author: L('Анна К.', 'Anna K.'),
    software: L('Фото iOS 19.1 · 2 правки', 'iOS 19.1 Photos · 2 edits'),
    thumbnails: '160 × 120',
    descriptions: L('«Дача, май»', '“Cabin, May”'),
    filename: 'IMG_4821 → photo_01',
  },
  tags: [
    ['GPS', 'GPSLatitude', '55° 45′ 7.92″ N'], ['GPS', 'GPSLongitude', '37° 36′ 56.16″ E'], ['GPS', 'GPSAltitude', '156.2 m'], ['GPS', 'GPSHPositioningError', '4.7 m'],
    ['IFD0', 'Make', 'Apple'], ['IFD0', 'Model', 'iPhone 15 Pro'], ['ExifIFD', 'LensSerialNumber', 'F7A3…91C'], ['ExifIFD', 'LensModel', 'iPhone 15 Pro back triple camera 6.86mm f/1.78'],
    ['ExifIFD', 'DateTimeOriginal', '2026:05:12 18:42:07'], ['ExifIFD', 'OffsetTimeOriginal', '+03:00'], ['IFD0', 'ModifyDate', '2026:05:13 09:10:44'],
    ['IFD0', 'Artist', 'Anna K.'], ['IFD0', 'Software', '19.1'], ['XMP', 'CreatorTool', 'Photos 19.1'], ['IFD1', 'ThumbnailImage', '(Binary data 7412 bytes)'],
    ['XMP', 'Description', 'Дача, май'], ['ICC', 'ProfileDescription', 'Display P3'], ['IFD0', 'Orientation', 'Rotate 90 CW'],
  ],
});
const BATCH = () => [
  { name: 'IMG_4821.HEIC', bytes: 3.4e6, kind: 'photo', found: ['location', 'device', 'dates', 'thumbnails'] },
  { name: 'IMG_4822.HEIC', bytes: 3.1e6, kind: 'photo', found: ['location', 'device', 'dates'] },
  { name: 'VID_0091.MOV', bytes: 184e6, kind: 'video', found: ['location', 'device', 'dates'] },
  { name: L('Отчёт_Q3.docx', 'Q3_report.docx'), bytes: 220e3, kind: 'doc', found: ['author', 'software', 'dates'] },
  { name: L('Скан_договора.pdf', 'Contract_scan.pdf'), bytes: 1.2e6, kind: 'pdf', found: ['software', 'dates'] },
  { name: 'voice_memo.m4a', bytes: 2.3e6, kind: 'audio', found: ['device', 'dates'] },
  { name: 'notes.txt', bytes: 4e3, kind: 'text', plain: true, found: [] },
  { name: L('Презентация.key', 'Pitch.key'), bytes: 18e6, kind: 'other', unsupported: true, found: [] },
];

/* ---------- state ---------- */
const S = {
  screen: 'start', mode: localStorage.getItem('um-mode') || 'maximum',
  custom: new Set(MODES.maximum), details: false, modeOpen: false, view: 'after',
  file: PHOTO(), batch: BATCH(), batchPhase: 'found', large: { phase: 'ask', p: 0 },
  saved: false, toast: '', customOpen: false,
};
const active = () => (S.mode === 'custom' ? S.custom : MODES[S.mode]);
const mobile = () => matchMedia('(max-width: 640px), (pointer: coarse)').matches;

/* ---------- render ---------- */
const btn = (action, label, cls = '', icon = '', extra = '') =>
  `<button type="button" class="btn ${cls}" data-action="${action}" ${extra}>${icon ? ic(icon) : ''}<span>${label}</span></button>`;

function header() {
  const dark = document.documentElement.dataset.theme === 'dark';
  return `<header class="top">
    <a class="brand" href="#" data-action="home" aria-label="Unmeta">${DIR.logo ? DIR.logo() : '<span class="brand-mark" aria-hidden="true"></span>'}<span class="brand-name">Unmeta</span></a>
    <div class="top-tools">
      <button type="button" class="tool" data-action="lang" aria-label="${t('settings.language')}: ${m('langBtn')}"><span>${lang === 'ru' ? 'EN' : 'RU'}</span></button>
      <button type="button" class="tool" data-action="theme" aria-label="${m('theme')}">${ic(dark ? 'sun' : 'moon')}</button>
    </div></header>`;
}
function footer() {
  return `<footer class="foot"><span class="foot-promise">${ic('lock')}${t('footer.promise')}</span><span class="foot-links"><a href="#">${t('footer.privacy')}</a><a href="#">${t('footer.source')}</a><span class="foot-lic">${t('footer.license')}</span></span></footer>`;
}

const fileHead = (f, extra = '') => `<div class="file-head">
  <div class="thumb" style="view-transition-name:hero">${thumb(f.kind)}</div>
  <div class="file-meta"><div class="file-name">${f.name}</div><div class="file-size">${size(f.bytes)}${extra}</div></div></div>`;

function screenStart() {
  return `<section class="screen s-start">
    <div class="hero">
      <h1 class="hero-title">${DIR.heroTitle ? DIR.heroTitle(t('start.title')) : t('start.title')}</h1>
      <p class="hero-sub">${t('start.subtitle')}</p>
    </div>
    <div class="drop" data-action="pick" role="button" tabindex="0" aria-label="${t('a11y.dropzone')}">
      ${DIR.dropArt ? DIR.dropArt() : ''}
      <div class="drop-inner">
        <span class="drop-icon">${ic('upload')}</span>
        <p class="drop-title"><span class="when-idle">${t('start.drop')}</span><span class="when-drag">${t('start.dropActive')}</span></p>
        <p class="drop-or">${t('start.or')}</p>
        ${btn('pick', mobile() ? m('pickMedia') : t('start.choose'), 'btn-primary btn-pick')}
        <p class="drop-hint">${mobile() ? m('multiMobile') : t('start.multipleHint')}</p>
        ${mobile() ? `<button type="button" class="link-btn pick-files" data-action="pickFiles">${m('pickFiles')}</button>` : ''}
      </div>
    </div>
    <div class="start-extra">
      <p class="privacy-line">${ic('lock')}<span>${t('start.privacy')} <a href="#">${t('start.privacyLink')}</a></span></p>
      <details class="what"><summary>${t('start.whatIsHidden')}${ic('chevron')}</summary><p>${t('start.whatIsHiddenBody')}</p></details>
      <button type="button" class="link-btn" data-action="demo">${m('demo')}</button>
    </div>
    <div class="dock">${btn('pick', m('pickMedia'), 'btn-primary btn-block')}</div>
  </section>`;
}

function rowsHtml(f, phase) {
  const set = active();
  const cats = CATS.filter((c) => c in f.found);
  return `<ul class="finds" role="list">${cats.map((c, i) => {
    const rm = set.has(c), state = rm ? 'remove' : 'keep';
    const ev = c === 'location' ? L('Координаты места съёмки', 'Coordinates of where it was taken')
      : c === 'filename' && !rm ? f.name.replace(/\.\w+$/, '') : f.found[c];
    const text = phase === 'after' ? t(`categories.${c}.name`) : t(`categories.${c}.found`, { state, neutral: f.neutral || 'photo_01' });
    return `<li class="find ${rm ? 'is-remove' : 'is-keep'} cat-${c}" style="--i:${i}" data-cat="${c}">
      <span class="find-icon">${ic(c)}</span>
      <span class="find-body">
        <span class="find-text">${text}</span>
        ${ev ? `<span class="find-ev"><span class="ev-val">${ev}</span><span class="redact" aria-hidden="true"></span></span>` : ''}
        <span class="find-why">${t(`categories.${c}.why`)}</span>
      </span>
      <span class="find-state" aria-hidden="true">${phase === 'after' ? (rm ? ic('check') : '') : ''}<span>${phase === 'after' ? (rm ? t('result.removed') : t('result.kept')) : (rm ? m('willRemove') : m('willKeep'))}</span></span>
    </li>`;
  }).join('')}</ul>`;
}

function modePicker() {
  const opts = ['maximum', 'balanced', 'privateOnly', 'custom'];
  return `<div class="modes ${S.modeOpen ? 'is-open' : ''}" role="radiogroup" aria-label="${t('modes.label')}">
    <div class="modes-head"><span class="modes-label">${t('modes.label')}</span><span class="modes-note">${t('modes.remembered')}</span></div>
    <div class="mode-list">${opts.map((k) => `<button type="button" role="radio" aria-checked="${S.mode === k}" class="mode ${S.mode === k ? 'is-on' : ''}" data-action="mode" data-mode="${k}">
      <span class="mode-icon">${ic(MODE_ICON[k])}</span><span class="mode-name">${t(`modes.${k}.name`)}</span><span class="mode-for">${t(`modes.${k}.for`)}</span></button>`).join('')}</div>
    <details class="custom-wrap" ${S.mode === 'custom' || S.customOpen ? 'open' : ''}><summary data-action="customOpen">${t('modes.custom.heading')}${ic('chevron')}</summary>
    <fieldset class="custom"><legend class="vh">${t('modes.custom.heading')}</legend>${CATS.map((c, i) => `<label class="chk" style="--i:${i}"><input type="checkbox" data-action="toggle" data-cat="${c}" aria-label="${t('modes.custom.toggleLabel', { category: t(`categories.${c}.name`) })}" ${active().has(c) ? 'checked' : ''}><span class="chk-box">${ic('check')}</span>${ic(c)}<span>${t(`categories.${c}.name`)}</span></label>`).join('')}</fieldset></details>
  </div>`;
}

function modeChip() {
  return `<button type="button" class="mode-chip" data-action="modeOpen" aria-expanded="${S.modeOpen}">${ic(MODE_ICON[S.mode])}<span>${t(`modes.${S.mode}.name`)}</span>${ic('chevron', 'chev')}</button>`;
}

function screenReport() {
  const f = S.file, n = Object.keys(f.found).length;
  return `<section class="screen s-report">
    <div class="pane pane-file">
      ${fileHead(f)}
      <h1 class="sec-title">${t('report.title')}</h1>
      <p class="summary">${t('report.summary', { count: n })}</p>
      ${rowsHtml(f, 'report')}
      <p class="kept-always">${ic('info')}${t('report.alwaysKept')}</p>
      ${details(f)}
    </div>
    <div class="pane pane-act">
      ${modePicker()}
      <div class="act-row">${modeChip()}${btn('clean', t('actions.clean'), 'btn-primary btn-clean', 'eraser')}</div>
    </div>
    <div class="dock">${modeChip()}${btn('clean', t('actions.clean'), 'btn-primary btn-clean', 'eraser')}</div>
  </section>`;
}

function details(f) {
  return `<details class="tags" ${S.details ? 'open' : ''}><summary data-action="details">${t('report.details')} <span class="tags-n">${f.tags.length}</span>${ic('chevron')}</summary>
    <p class="tags-hint">${t('report.detailsHint')}</p>
    <table><tbody>${f.tags.map(([g, k, v]) => `<tr><td class="tg">${g}</td><td class="tk">${k}</td><td class="tv">${v}</td></tr>`).join('')}</tbody></table></details>`;
}

function screenAfter() {
  const f = S.file, set = active(), all = Object.keys(f.found).every((c) => set.has(c));
  const name = set.has('filename') ? `${f.neutral}_clean.heic` : f.name.replace(/\.(\w+)$/, '_clean.$1').replace('.HEIC', '.heic');
  return `<section class="screen s-after view-${S.view}">
    <div class="pane pane-file">
      ${fileHead(f, ` <span class="arrow">→</span> <span class="newname">${name}</span>`)}
      <div class="done-head"><span class="done-badge">${ic('check')}</span><div><h1 class="sec-title">${t('result.done')}</h1><p class="summary">${all ? t('result.verified') : t('result.verifiedKept')}</p></div></div>
      <div class="ba" role="tablist" aria-label="${t('result.before')} / ${t('result.after')}">
        <button type="button" role="tab" aria-selected="${S.view === 'before'}" data-action="view" data-view="before">${t('result.before')}</button>
        <button type="button" role="tab" aria-selected="${S.view === 'after'}" data-action="view" data-view="after">${t('result.after')}</button>
        <span class="ba-pill" aria-hidden="true"></span>
      </div>
      ${rowsHtml(f, 'after')}
      <p class="kept-always">${ic('info')}${t('result.leftover')} ${t('report.alwaysKept')}</p>
    </div>
    <div class="pane pane-act">
      <div class="get">
        ${mobile() ? btn('save', S.saved ? m('saved') : t('actions.save'), 'btn-primary btn-get' + (S.saved ? ' is-done' : ''), S.saved ? 'check' : 'share')
                   : btn('save', S.saved ? m('saved') : t('actions.download'), 'btn-primary btn-get' + (S.saved ? ' is-done' : ''), S.saved ? 'check' : 'download')}
        <p class="get-hint">${mobile() ? t('actions.saveHint') : t('result.newName', { name })}</p>
        <p class="get-safe">${t('result.originalSafe')}</p>
        ${btn('home', t('actions.startOver'), 'btn-quiet')}
      </div>
    </div>
    <div class="dock">${btn('save', S.saved ? m('saved') : (mobile() ? t('actions.save') : t('actions.download')), 'btn-primary btn-block btn-get' + (S.saved ? ' is-done' : ''), S.saved ? 'check' : (mobile() ? 'share' : 'download'))}</div>
  </section>`;
}

function batchRow(f, i) {
  const ph = S.batchPhase;
  let status;
  if (f.unsupported) status = `<span class="st st-skip">${ic('info')}${t('unsupported.title')}</span>`;
  else if (f.plain) status = `<span class="st st-plain">${ic('check')}${t('plainText.title')}</span>`;
  else if (ph === 'found') status = `<span class="chips">${f.found.slice(0, 3).map((c) => `<span class="chip cat-${c}">${ic(c)}${m('short.' + c)}</span>`).join('')}</span>`;
  else if (ph === 'cleaning') status = `<span class="st st-run"><span class="bar"><span class="bar-fill" style="--d:${0.5 + (i % 4) * 0.25}s;--delay:${i * 0.12}s"></span></span></span>`;
  else status = `<span class="st st-ok">${ic('check')}${t('result.done')}</span>`;
  const get = ph === 'done' && !f.unsupported && !f.plain ? `<button type="button" class="icon-btn" data-action="noop" aria-label="${t('actions.download')} ${f.name}">${ic(mobile() ? 'share' : 'download')}</button>` : '';
  return `<li class="brow ${f.unsupported ? 'is-skip' : ''}" style="--i:${i}">
    <div class="thumb sm">${thumb(f.kind, i)}</div>
    <div class="brow-meta"><div class="file-name">${f.name}</div><div class="file-size">${size(f.bytes)}</div></div>
    <div class="brow-status">${status}</div>${get}</li>`;
}

function screenBatch() {
  const B = S.batch, cleanable = B.filter((f) => !f.unsupported && !f.plain), geo = B.filter((f) => f.found.includes('location')).length;
  const ph = S.batchPhase, total = B.reduce((a, f) => a + (f.unsupported ? 0 : f.bytes), 0);
  const head = ph === 'done'
    ? `<p class="summary">${t('batch.cleaned', { count: cleanable.length })} · ${t('batch.skipped', { count: 1 })}</p>`
    : `<p class="summary">${t('batch.files', { count: B.length })} · ${ic('location', 'inline')} ${L(`в ${geo} из ${B.length} есть точная геопозиция`, `${geo} of ${B.length} have an exact location`)}</p>`;
  const action = ph === 'done'
    ? `${btn('noop', t('actions.downloadAll'), 'btn-primary btn-all', mobile() ? 'share' : 'download')}<span class="all-hint">${t('actions.downloadAllHint')} · ${size(total)}</span>`
    : ph === 'cleaning' ? `<span class="all-progress">${t('progress.cleaning')}</span>`
    : btn('cleanBatch', t('actions.cleanCount', { count: cleanable.length }), 'btn-primary btn-clean', 'eraser');
  return `<section class="screen s-batch phase-${ph}">
    <div class="pane pane-file">
      <div class="batch-head"><h1 class="sec-title">${ph === 'done' ? t('result.done') : t('report.title')}</h1>${head}</div>
      <ul class="blist" role="list">${B.map(batchRow).join('')}</ul>
      <button type="button" class="link-btn" data-action="noop">${ic('plus')}${t('actions.addMore')}</button>
    </div>
    <div class="pane pane-act">${ph === 'found' ? modeChip() : ''}<div class="batch-act">${action}</div></div>
    <div class="dock">${ph === 'found' ? modeChip() : ''}${action}</div>
  </section>`;
}

function screenUnsupported() {
  const f = { name: L('Презентация.key', 'Pitch.key'), bytes: 18e6, kind: 'other' };
  return `<section class="screen s-msg s-unsupported">
    <div class="msg">
      ${fileHead(f)}
      <h1 class="sec-title">${t('unsupported.title')}</h1>
      <p class="msg-body">${t('unsupported.body')}</p>
      <p class="msg-meta">${t('unsupported.format', { ext: '.key (Keynote)' })}</p>
      <p class="msg-tip">${ic('info')}${m('exportTip')}</p>
      <div class="msg-act">${btn('pick', m('chooseOther'), 'btn-primary')}${btn('home', t('actions.close'), 'btn-quiet')}</div>
    </div></section>`;
}

function screenLarge() {
  const f = { name: 'VID_2026_05_12.MOV', bytes: 2.4 * 1073741824, kind: 'video' }, L2 = S.large;
  const pct = Math.round(L2.p * 100), stage = L2.p < 0.15 ? 'reading' : L2.p < 0.9 ? 'cleaning' : 'verifying';
  const body = L2.phase === 'ask'
    ? `<h1 class="sec-title">${t('bigFile.title', { size: size(f.bytes) })}</h1>
       <p class="msg-body">${t('bigFile.body')}</p>
       <div class="msg-act">${btn('largeTry', t('bigFile.try'), 'btn-primary')}${btn('home', t('bigFile.skip'), 'btn-quiet')}</div>`
    : L2.phase === 'run'
    ? `<h1 class="sec-title" aria-live="polite">${t('progress.' + stage)}</h1>
       <div class="big-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-label="${t('a11y.progress', { name: f.name, percent: pct })}">
         <div class="bp-track"><div class="bp-fill" style="--p:${L2.p}"></div></div>
         <div class="bp-nums"><span class="bp-pct">${t('progress.percent', { percent: pct })}</span><span class="bp-left">${m('of', { a: size(f.bytes * L2.p), b: size(f.bytes) })} · ${m('left', { s: Math.max(1, Math.round((1 - L2.p) * 14)) })}</span></div>
       </div>
       <div class="msg-act">${btn('largeCancel', t('actions.cancel'), 'btn-quiet')}</div>`
    : `<div class="done-head"><span class="done-badge">${ic('check')}</span><div><h1 class="sec-title">${t('result.done')}</h1><p class="summary">${t('result.verified')}</p></div></div>
       <div class="msg-act">${btn('save', mobile() ? t('actions.save') : t('actions.download'), 'btn-primary', mobile() ? 'share' : 'download')}${btn('home', t('actions.startOver'), 'btn-quiet')}</div>`;
  return `<section class="screen s-msg s-large phase-${L2.phase}"><div class="msg">${fileHead(f)}${body}</div></section>`;
}

const SCREENS = { start: screenStart, report: screenReport, after: screenAfter, batch: screenBatch, unsupported: screenUnsupported, large: screenLarge };

function toolbar() {
  if (qs.get('ui') === '0') return '';
  const cur = S.screen === 'report' && S.modeOpen ? 'modes' : S.screen;
  return `<nav class="mock-bar" aria-label="${m('mock')}"><span class="mb-tag">${m('mock')} · ${DIR.name || ''}</span>${Object.keys(M.ru.s).map((k) =>
    `<button type="button" data-action="jump" data-to="${k}" aria-current="${cur === k}">${m('s.' + k)}</button>`).join('')}<a href="index.html">↩</a></nav>`;
}

/* ---------- mount with View Transitions ---------- */
const app = () => $('#app');
let first = true;
function paint() {
  document.documentElement.lang = lang;
  document.body.dataset.screen = S.screen;
  app().innerHTML = header() + `<main id="main">${SCREENS[S.screen]()}</main>` + footer() + toolbar() + `<div class="toast" role="status" aria-live="polite">${S.toast}</div>`;
  if (first && !STILL) document.body.classList.add('intro');
  first = false;
  DIR.after?.(S);
}
function go(fn, dir = 'fwd') {
  const run = () => { fn(); paint(); };
  if (!document.startViewTransition || RM || STILL) return run();
  document.documentElement.dataset.nav = dir;
  document.startViewTransition(run);
}
function toast(msg) {
  S.toast = msg; const el = $('.toast'); if (!el) return;
  el.textContent = msg; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3200);
}

/* Progress driven by one rAF loop writing a CSS var (transform-only animation). */
function runProgress(ms, onTick, onDone) {
  const t0 = performance.now();
  const step = (now) => { const p = Math.min(1, (now - t0) / ms); onTick(p); p < 1 ? requestAnimationFrame(step) : onDone(); };
  requestAnimationFrame(step);
}

/* ---------- actions ---------- */
/* Two pickers. Phones: the main button opens the system photo picker (image/video only), where
   several photos are ticked with a tap — a mixed accept list sends Android to the Files app instead,
   where multi-select needs a long-press nobody knows about. Documents get their own secondary link. */
const mkInput = (accept) => {
  const i = Object.assign(document.createElement('input'), { type: 'file', multiple: true, accept, hidden: true });
  i.addEventListener('change', () => { route([...i.files]); i.value = ''; });
  document.body.append(i); return i;
};
const anyInput = mkInput('image/*,video/*,audio/*,.pdf,.doc,.docx,.xlsx,.pptx,.odt,.ods,.odp,.svg,.txt,.md,.csv,.json,*/*');
const mediaInput = mkInput('image/*,video/*');
function route(files) {
  if (!files.length) return;
  if (files.length > 1) return go(() => { S.screen = 'batch'; S.batchPhase = 'found'; });
  const f = files[0], ext = (f.name.split('.').pop() || '').toLowerCase();
  if (f.size > 1.5 * 1073741824) return go(() => { S.screen = 'large'; S.large = { phase: 'ask', p: 0 }; });
  if (!/^(jpe?g|heic|heif|avif|png|webp|tiff?|gif|dng|cr2|nef|arw|mp4|mov|m4v|m4a|mp3|wav|flac|ogg|webm|mkv|pdf|docx?|xlsx|pptx|od[tsp]|svg|txt|md|csv|json)$/.test(ext))
    return go(() => { S.screen = 'unsupported'; });
  go(() => { S.file = { ...PHOTO(), name: f.name, bytes: f.size }; S.screen = 'report'; S.saved = false; });
}

const A = {
  home: () => go(() => { S.screen = 'start'; S.modeOpen = false; S.saved = false; S.batchPhase = 'found'; }, 'back'),
  pick: () => (mobile() ? mediaInput : anyInput).click(),
  pickFiles: () => anyInput.click(),
  demo: () => go(() => { S.file = PHOTO(); S.screen = 'report'; S.saved = false; }),
  lang: () => { lang = lang === 'ru' ? 'en' : 'ru'; localStorage.setItem('um-lang', lang); S.file = PHOTO(); S.batch = BATCH(); paint(); },
  theme: () => { const r = document.documentElement; r.dataset.theme = r.dataset.theme === 'dark' ? 'light' : 'dark'; localStorage.setItem('um-theme', r.dataset.theme); paint(); },
  modeOpen: () => { S.modeOpen = !S.modeOpen; if (S.screen !== 'report') go(() => { S.screen = 'report'; S.modeOpen = true; }); else paintKeep(); },
  mode: (el) => { const k = el.dataset.mode; if (k === 'custom' && S.mode !== 'custom') S.custom = new Set(active()); S.mode = k; localStorage.setItem('um-mode', k); if (k !== 'custom' && matchMedia('(max-width: 999px)').matches && DIR.sheet) S.modeOpen = false; paintKeep(); },
  toggle: (el) => {
    if (S.mode !== 'custom') { S.custom = new Set(active()); S.mode = 'custom'; localStorage.setItem('um-mode', 'custom'); toast(t('modes.custom.switched')); }
    S.customOpen = true;
    el.checked ? S.custom.add(el.dataset.cat) : S.custom.delete(el.dataset.cat); paintKeep();
  },
  customOpen: (el, e) => { e.preventDefault(); S.customOpen = !S.customOpen; paintKeep(); }, // custom mode keeps the list open
  details: (el, e) => { e.preventDefault(); S.details = !S.details; paintKeep(); },
  clean: (el) => {
    const b = el.closest('.btn'); b.classList.add('is-busy'); b.disabled = true;
    document.querySelectorAll('.btn-clean').forEach((x) => { x.classList.add('is-busy'); x.setAttribute('aria-busy', 'true'); });
    document.body.classList.add('cleaning');
    runProgress(RM ? 10 : 1100, (p) => document.documentElement.style.setProperty('--clean-p', p), () => {
      document.body.classList.remove('cleaning');
      go(() => { S.screen = 'after'; S.view = 'after'; S.modeOpen = false; S.saved = false; });
      requestAnimationFrame(() => document.body.classList.add('erasing'));
      setTimeout(() => document.body.classList.remove('erasing'), 2400);
    });
  },
  view: (el) => { S.view = el.dataset.view; const s = $('.s-after'); s.classList.remove('view-before', 'view-after'); s.classList.add('view-' + S.view);
    s.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', b.dataset.view === S.view)); },
  save: (el) => { el.classList.add('is-pressed'); setTimeout(() => { S.saved = true; paintKeep(); }, 260); },
  cleanBatch: () => { S.batchPhase = 'cleaning'; paintKeep(); setTimeout(() => { S.batchPhase = 'done'; paintKeep(); }, RM ? 50 : 2200); },
  largeTry: () => { S.large = { phase: 'run', p: 0 }; paintKeep(); largeLoop(); },
  largeCancel: () => { S.large = { phase: 'ask', p: 0 }; paintKeep(); },
  jump: (el) => jump(el.dataset.to),
  noop: (el) => { el.classList.add('is-pressed'); setTimeout(() => el.classList.remove('is-pressed'), 300); },
};
function largeLoop() {
  const t0 = performance.now(), ms = RM ? 200 : 6000;
  const tick = (now) => {
    if (S.large.phase !== 'run') return;
    S.large.p = Math.min(1, (now - t0) / ms);
    const fill = $('.bp-fill'); fill?.style.setProperty('--p', S.large.p);
    const pct = Math.round(S.large.p * 100), bar = $('.big-progress');
    if (bar) { bar.setAttribute('aria-valuenow', pct); $('.bp-pct').textContent = t('progress.percent', { percent: pct });
      $('.bp-left').textContent = `${m('of', { a: size(2.4 * 1073741824 * S.large.p), b: size(2.4 * 1073741824) })} · ${m('left', { s: Math.max(1, Math.round((1 - S.large.p) * 6)) })}`;
      const stage = S.large.p < 0.15 ? 'reading' : S.large.p < 0.9 ? 'cleaning' : 'verifying', h = $('.s-large .sec-title'), txt = t('progress.' + stage);
      if (h.textContent !== txt) h.textContent = txt; }
    if (S.large.p < 1) requestAnimationFrame(tick); else go(() => { S.large.phase = 'done'; });
  };
  requestAnimationFrame(tick);
}
/* Re-render without a page transition, keeping scroll & focus target. */
function paintKeep() {
  const y = scrollY, focusKey = document.activeElement?.dataset?.mode || document.activeElement?.dataset?.cat || document.activeElement?.dataset?.action;
  paint(); scrollTo(0, y); document.body.classList.add('no-intro');
  if (focusKey) $(`[data-mode="${focusKey}"],[data-cat="${focusKey}"] input,[data-action="${focusKey}"]`)?.focus({ preventScroll: true });
}
function jump(to) {
  S.saved = false; S.modeOpen = false;
  if (to === 'modes') { S.screen = 'report'; S.modeOpen = true; if (S.mode !== 'custom') { S.custom = new Set(MODES.balanced); S.custom.add('dates'); S.mode = 'custom'; } }
  else if (to === 'large') { S.screen = 'large'; S.large = { phase: 'ask', p: 0 }; }
  else if (to === 'largeProgress') { S.screen = 'large'; S.large = { phase: 'run', p: 0.62 }; }
  else if (to === 'batch') { S.screen = 'batch'; S.batchPhase = qs.get('phase') || 'found'; }
  else { S.screen = to; if (to === 'after') S.view = qs.get('view') || 'after'; }
  go(() => {});
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]'); if (!el) return;
  if (el.tagName === 'INPUT') return; // checkboxes handled on change
  if (el.tagName === 'A') e.preventDefault();
  A[el.dataset.action]?.(el, e);
});
document.addEventListener('change', (e) => { if (e.target.dataset.action === 'toggle') A.toggle(e.target); });
document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('drop')) { e.preventDefault(); A.pick(); } });
let dragN = 0;
addEventListener('dragenter', (e) => { e.preventDefault(); dragN++; document.body.classList.add('dragging'); });
addEventListener('dragleave', () => { if (--dragN <= 0) { dragN = 0; document.body.classList.remove('dragging'); } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); dragN = 0; document.body.classList.remove('dragging'); route([...e.dataTransfer.files]); });

/* ---------- boot ---------- */
const theme = qs.get('theme') || localStorage.getItem('um-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
document.documentElement.dataset.theme = theme;
if (qs.get('ui') === '0') document.body.classList.add('no-mockbar');
if (STILL) document.body.classList.add('still');
const start = qs.get('screen');
if (start) { STILL || true; jump(start); } else paint();
if (start === 'after' && !STILL) { requestAnimationFrame(() => document.body.classList.add('erasing')); }
window.UM = { S, t, paint, jump };
})();
