// Where the reader is: the url, the place in a book, a chapter as its lines, and how sizes and
// dates are said. Nothing here keeps state.

export type Route = Record<string, string | number | null | undefined>;

export class HashRouter {
  parse(hash: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(hash));
  }
  get(key: string) {
    return new URLSearchParams(location.hash.slice(1)).get(key);
  }
  current() {
    return this.parse(location.hash.slice(1));
  }
  route(route: Route) {
    let hash = new URLSearchParams(Object.entries(route).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
    return hash ? `#${hash}` : hash;
  }
  // the url holds strings and the page numbers, and an absent value is null or undefined
  changes(to: Route) {
    let from: Route = this.current();
    // loose on purpose, '12' is 12 here
    return Object.keys({ ...from, ...to }).some(key => from[key] != to[key]);
  }
  push(to: Route) {
    if (!this.changes(to)) return;
    let url = new URL(location.href);
    url.hash = this.route(to);
    history.pushState(null, '', url);
  }
  replace(to: Route) {
    if (!this.changes(to)) return;
    let url = new URL(location.href);
    url.hash = this.route(to);
    history.replaceState(null, '', url);
  }
}

// an absent url param reads as null, and Number(null) is a perfectly good 0
export function toOffset(value: unknown): number | undefined {
  if (value == null || value === '') return;
  let number = Number(value);
  if (Number.isFinite(number)) return number;
}

export type Listed = { id: string; title: string; offset: number; group?: string; part?: { of: string; text: string } };
export type Chapter = Listed & { content: string };

// the chapter a character offset falls in: the last one starting at or before it.
// an offset outlives a re-parse that retitles a chapter, which its slug never did
export function chapterAt(chapters: Listed[], offset: unknown) {
  let at = toOffset(offset);
  if (at == null) return;
  let placed = chapters.filter(chapter => chapter.offset != null);
  return placed.findLast(chapter => chapter.offset <= at) || placed[0];
}

export type Line = { text: string; offset: number };

// one paragraph per line, each with the offset it starts at in the book. The
// reader sees the names corrected, and that changes lengths, so the offsets are
// read off the text as stored
const lineSeparator = /\n|<\/?\w+>/gi;
export function chapterLines(chapter: Chapter, fixNames: (text: string) => string): Line[] {
  let fixed = fixNames(chapter.content).split(lineSeparator);
  let lines: Line[] = [];
  let at = 0;
  for (let m of chapter.content.matchAll(lineSeparator)) {
    lines.push({ text: chapter.content.slice(at, m.index), offset: chapter.offset + at });
    at = m.index + m[0].length;
  }
  lines.push({ text: chapter.content.slice(at), offset: chapter.offset + at });
  // a correction that split or joined a line would shift every line after it
  if (fixed.length === lines.length) for (let [i, line] of lines.entries()) line.text = fixed[i];
  return lines;
}

// a line as the page shows it: a rule, a line of marks set apart, or prose with its links
export type Piece = string | { href: string };
export function lineKind(line: string): 'rule' | 'marks' | 'prose' {
  if (/^[-]+$/.test(line)) return 'rule';
  if (/^[^\p{L}\p{N}"]+$/u.test(line)) return 'marks';
  return 'prose';
}
export function linePieces(line: string): Piece[] {
  let pieces: Piece[] = [];
  let m;
  while ((m = /https?:\/\/\S+/.exec(line))) {
    if (m.index > 0) pieces.push(line.slice(0, m.index));
    pieces.push({ href: m[0] });
    line = line.slice(m.index + m[0].length);
  }
  if (line) pieces.push(line);
  return pieces;
}

// where the reader is: the topmost paragraph the page has not scrolled past. They
// come in document order, so a binary search costs a chapter of any length only a
// handful of measurements
export function offsetAtTop() {
  let paragraphs = document.querySelectorAll<HTMLElement>('article [data-offset]');
  if (!paragraphs.length) return;
  let low = 0;
  let high = paragraphs.length - 1;
  while (low < high) {
    let middle = (low + high) >> 1;
    if (paragraphs[middle].getBoundingClientRect().bottom > 0) high = middle;
    else low = middle + 1;
  }
  return Number(paragraphs[low].dataset.offset);
}

// where in a book to reopen: its offset, or - for a bookmark or a progress record
// written before offsets - the chapter id it still names
export function bookRoute({ bookId, offset, chapterId }: { bookId: string; offset?: unknown; chapterId?: string }): Route {
  return offset != null ? { book: bookId, offset: offset as number } : { book: bookId, chapter: chapterId };
}

const sizeFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', style: 'unit', unit: 'byte', unitDisplay: 'narrow' });
export const formatSize = (size: number) => sizeFormatter.format(size);

const dateFormatter = new Intl.RelativeTimeFormat();
export function formatDate(iso?: string) {
  if (!iso) return;
  let diff = (Date.now() - new Date(iso).getTime()) / 1000;
  for (let [unit, seconds] of Object.entries({
    months: 30 * 24 * 60 * 60,
    days: 24 * 60 * 60,
    hours: 60 * 60,
    minutes: 60,
    seconds: 0,
  })) {
    if (diff >= seconds) return dateFormatter.format(-Math.round(diff / (seconds || 1)), unit as Intl.RelativeTimeFormatUnit);
  }
}

// two frames: the page has drawn what was asked of it
export async function nextTick() {
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
}

// a key, with its modifiers (`Cmd+K`), calls `act` while it is pressed on `target`
export function onKey(key: string, act: (event: KeyboardEvent) => void, target: EventTarget = window) {
  let wanted: Record<string, boolean | string> = {};
  for (let k of key.toLowerCase().split('+')) {
    if (['ctrl', 'shift', 'alt'].includes(k)) wanted[`${k}Key`] = true;
    else if (['cmd', 'win', 'super'].includes(k)) wanted.metaKey = true;
    else wanted.key = k;
  }
  let onKeyDown = (event: Event) => {
    let pressed = event as KeyboardEvent;
    let same = pressed.key.toLowerCase() === wanted.key
      && ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'].every(f => Boolean(pressed[f as 'metaKey']) === Boolean(wanted[f]));
    if (!same) return;
    pressed.preventDefault();
    act(pressed);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}

export function getColorScheme() {
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
