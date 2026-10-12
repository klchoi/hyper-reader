// Where the reader is: the url, the place in a book, a chapter as its lines, and how sizes and
// dates are said. Nothing here keeps state.
import type { Chapter, Listed } from './parser.ts';

// A place in the page: a book, and where in it (an offset, or for an older link the id of a
// chapter), or nothing, the library.
export type Route = { book?: string; offset?: number | string; chapter?: string };

// The url of a place, and the place of the url. The page served by the server has real paths
// (`/books/<id>?at=<offset>`); opened as a file, it has only the part after `#` to keep a place
// in (`#book=<id>&offset=<offset>`). Either is changed as the reader moves (push: a step back
// returns to it; replace: it does not), and calls `listen`ers when the reader steps back or on
export interface Router {
  current(): Route;
  route(to: Route): string;
  push(to: Route): void;
  replace(to: Route): void;
  listen(changed: (to: Route) => void): () => void;
}

const sameRoute = (from: Route, to: Route) => (['book', 'offset', 'chapter'] as const)
  // the url holds strings and the page numbers, and an absent value is null or undefined
  .every(key => String(from[key] ?? '') === String(to[key] ?? ''));

function fromHash(hash: string): Route {
  let params = new URLSearchParams(hash.replace(/^#/, ''));
  return { book: params.get('book') ?? undefined, offset: params.get('offset') ?? undefined, chapter: params.get('chapter') ?? undefined };
}

export class HashRouter implements Router {
  current() {
    return fromHash(location.hash);
  }
  route(to: Route) {
    let hash = new URLSearchParams(Object.entries(to).filter(([, v]) => v !== '' && v != null).map(([k, v]) => [k, String(v)])).toString();
    return hash ? `#${hash}` : '#';
  }
  push(to: Route) {
    if (!sameRoute(this.current(), to)) history.pushState(null, '', this.route(to));
  }
  replace(to: Route) {
    if (!sameRoute(this.current(), to)) history.replaceState(null, '', this.route(to));
  }
  listen(changed: (to: Route) => void) {
    let onHashChange = () => changed(this.current());
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  }
}

export class PathRouter implements Router {
  // a link made before the page had paths (`/#book=...`) still finds its place
  current(): Route {
    let found = /^\/books\/([^/]+)$/.exec(location.pathname);
    if (!found) return /\bbook=/.test(location.hash) ? fromHash(location.hash) : {};
    let params = new URLSearchParams(location.search);
    return { book: decodeURIComponent(found[1]), offset: params.get('at') ?? undefined, chapter: params.get('chapter') ?? undefined };
  }
  route(to: Route) {
    if (!to.book) return '/';
    let params = new URLSearchParams();
    if (to.offset != null && to.offset !== '') params.set('at', String(to.offset));
    else if (to.chapter) params.set('chapter', to.chapter);
    let query = params.toString();
    return `/books/${encodeURIComponent(to.book)}${query ? `?${query}` : ''}`;
  }
  push(to: Route) {
    if (!sameRoute(this.current(), to) || location.hash) history.pushState(null, '', this.route(to));
  }
  replace(to: Route) {
    if (!sameRoute(this.current(), to) || location.hash) history.replaceState(null, '', this.route(to));
  }
  listen(changed: (to: Route) => void) {
    let onPopState = () => changed(this.current());
    addEventListener('popstate', onPopState);
    return () => removeEventListener('popstate', onPopState);
  }
}

// the page served (by the server) has paths; the page opened as a file has only its hash
export const createRouter = (): Router => (location.protocol === 'file:' ? new HashRouter() : new PathRouter());

// an absent url param reads as null, and Number(null) is a perfectly good 0
export function toOffset(value: unknown): number | undefined {
  if (value == null || value === '') return;
  let number = Number(value);
  if (Number.isFinite(number)) return number;
}

export type { Chapter, Listed };

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
export function bookRoute({ bookId, offset, chapterId }: { bookId: string; offset?: unknown; chapterId?: string | null }): Route {
  return offset != null ? { book: bookId, offset: offset as number } : { book: bookId, chapter: chapterId ?? undefined };
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

// The text folded as search folds it (no accents, no case, `đ` as `d`), one character for one,
// so a place found in the one is the same place in the other
let folds = new Map<string, string>();
export function plainKeepingPlaces(text: string) {
  let out = '';
  for (let ch of text) {
    let f = folds.get(ch);
    if (f === undefined) {
      f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace('đ', 'd');
      if (f.length !== ch.length) f = ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
      folds.set(ch, f);
    }
    out += f;
  }
  return out;
}

// what was searched for, marked wherever the chapter on the page says it, however accented
export function markFound(phrase: string) {
  let words = plainKeepingPlaces(phrase.trim().replace(/\s+/g, ' '));
  let ranges: Range[] = [];
  if (words) {
    for (let paragraph of document.querySelectorAll('article p')) {
      for (let node of paragraph.childNodes) {
        if (node.nodeType !== Node.TEXT_NODE) continue;
        let said = plainKeepingPlaces(node.textContent || '');
        for (let at = said.indexOf(words); at >= 0; at = said.indexOf(words, at + words.length)) {
          let range = new Range();
          range.setStart(node, at);
          range.setEnd(node, at + words.length);
          ranges.push(range);
        }
      }
    }
  }
  CSS.highlights.set('found', new Highlight(...ranges));
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
