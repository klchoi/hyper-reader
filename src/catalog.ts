// The library as it is browsed: every book as its file describes it, and the books asked for out
// of it, a page at a time. What is asked (a `Query`):
//   q         words the title, the tags or the folder have, in any order, with or without accents
//   tags      tags the book has, all of them
//   size      [min, max] bytes, either left out for none
//   chapters  [min, max] chapters
//   title     every file of the book of this title, the older ones too (see below)
//   every     every file of every book
//   sort      latest (the file's time) | read (the books being read, the last read first) |
//             title | size | chapters | random (in an order of `seed`, the same page after page);
//             left out, the latest, or with words asked, the titles that say them as written first
//   order     asc | desc, against the sort's own (latest, read, size, chapters: desc; title: asc)
//   offset, limit
// The server answers it for its thousands of books (server/library.ts): the page only ever holds
// the page it shows.
//
// A book kept as it grew is a file for every time it was kept (`... (1-30 chương)`, `(1-41
// chương)`, `(1-66 chương)`): the library shows one book to a title, its newest file (among the
// books being read, the file read), saying how many files there are of it.
//
// A file's name says what the book is: `Đổi yêu gia tộc (1-416 chương) (np, bách hợp, mẹ con)`
// is the title, then in brackets its length (a note) and its tags. `kết thúc` (finished) is a tag
// wherever it is said.

export type Progress = { offset?: number; chapterId?: string; chapterIndex?: number; chapterCount?: number; updatedAt?: string };
export type Sort = 'latest' | 'read' | 'title' | 'size' | 'chapters' | 'random';
export type Query = {
  q?: string; tags?: string[]; size?: Range; chapters?: Range; title?: string; every?: boolean;
  sort?: Sort; order?: 'asc' | 'desc'; seed?: number; offset?: number; limit?: number;
};
export type Range = [min: number | null, max: number | null];
// a book as the library shows it: `date` is its file's time (ms), `read` where it was left
export type Shelved = {
  id: string; title: string; tags: string[]; note?: string; folder?: string;
  size: number; chapters: number; date: number; deletable: boolean; read?: Progress;
  // how many files there are of the book, when more than one
  versions?: number;
};
export type Listing = { total: number; offset: number; books: Shelved[] };
export type TagCount = { tag: string; count: number };
// a book in the catalog: what it shows, and what a search looks in (folded)
export type Entry = Omit<Shelved, 'read' | 'versions'> & { words: string; tagKeys: string[]; same: string };

export const PAGE = 30;
const MOST = 100;

// text as a search compares it: no accents, no case, đ as d (`Hoàng Dung` is `hoang dung`)
export const fold = (text: string) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replaceAll('đ', 'd').normalize('NFC');

// ---- what a file says it is
const BRACKETED = /[(（[【]([^()（）[\]【】]*)[)）\]】]/gu;
const LENGTH_WORDS = ['chương', 'bộ', 'quyển', 'tập', 'hồi', 'phiên ngoại', 'ngoại truyện', 'tiền truyện', 'thiên', 'phần'];
const FINISHED = /kết thúc|hoàn thành|hoàn tất|\bfull\b|\bend\b/giu;
export const FINISHED_TAG = 'kết thúc';
// `1-416 chương`, `1-3 bộ 116 chương + 4 phiên ngoại`, `1-44.9`: how long the book is
const isLength = (piece: string) => {
  let lower = piece.toLowerCase();
  return (/\d/.test(lower) && LENGTH_WORDS.some(word => lower.includes(word))) || /^\d+(?:[.,]\d+)?(?:\s*[-~]\s*\d+(?:[.,]\d+)?)?$/.test(lower);
};
// what a piece says once its `kết thúc` is taken out
const unfinished = (piece: string) => piece.replace(FINISHED, ' ').replace(/\s+/g, ' ').trim();

// what a file (its path in its library) says of the book: its title, its tags, a note of its
// length, and the folder it is in
export function describeFile(path: string): Pick<Shelved, 'title' | 'tags' | 'note' | 'folder'> {
  let parts = path.normalize().split('/');
  let name = parts.pop()!.replace(/\.txt$/i, '');
  let folder = parts[0]?.replace(/^[_\s]+/, '').trim() || undefined;
  let tags: string[] = [];
  let notes: string[] = [];
  let finished = false;
  for (let [, inside] of name.matchAll(BRACKETED)) {
    for (let piece of inside.split(/[,，、;；]/u).map(p => p.trim()).filter(Boolean)) {
      // `kết thúc` is a tag of its own; with a length (`1-71 kết thúc`), the piece is a note
      let rest = unfinished(piece);
      if (rest !== piece) finished = true;
      if (isLength(piece) || (rest !== piece && (!rest || isLength(rest)))) notes.push(piece);
      else tags.push(piece);
    }
  }
  // what is left once the brackets are out; `~ Edit name` after it is a note too
  let title = name.replace(BRACKETED, ' ').replace(/\s+/g, ' ').trim();
  let tilde = /\s+~\s*(.+)$/u.exec(title);
  if (tilde) {
    notes.push(tilde[1]);
    title = title.slice(0, tilde.index);
  }
  title = title.replace(/^[\s\-–—:~·,.]+|[\s\-–—:~·,.]+$/gu, '') || name;
  if (finished && !tags.some(tag => fold(tag) === fold(FINISHED_TAG))) tags.push(FINISHED_TAG);
  return {
    title: title.replace(/^\p{Ll}/u, c => c.toUpperCase()),
    tags: [...new Map(tags.map(tag => [fold(tag), tag])).values()],
    note: notes.join(' · ') || undefined,
    // (a folder of the book's own, named as it is, says nothing more)
    folder: folder && !fold(folder).startsWith(fold(title)) ? folder : undefined,
  };
}

// a book of the catalog, from its file
export function entryOf({ id, path, size, chapters, date, deletable }: { id: string; path: string; size: number; chapters: number; date: number; deletable: boolean }): Entry {
  let described = describeFile(path);
  return {
    id, ...described, size, chapters, date, deletable,
    words: fold([described.title, ...described.tags, described.folder ?? ''].join(' ')),
    tagKeys: described.tags.map(fold),
    same: fold(described.title),
  };
}

// ---- the books asked for
const byTitle = new Intl.Collator('vi', { sensitivity: 'base', numeric: true });
// an order of its own for every seed, the same each time it is asked: a page of a random
// listing follows the one before it
function shuffled(id: string, seed: number) {
  let hash = (seed ^ 0x811c9dc5) >>> 0;
  for (let k = 0; k < id.length; k++) hash = Math.imul(hash ^ id.charCodeAt(k), 0x01000193) >>> 0;
  hash ^= hash >>> 15;
  return Math.imul(hash, 0x2c1b3c6d) >>> 0;
}
const within = (value: number, [min, max]: Range = [null, null]) => (min == null || value >= min) && (max == null || value <= max);
const readAt = (read?: Progress) => (read?.updatedAt ? Date.parse(read.updatedAt) || 0 : 0);

// one book to a title: its newest file (by time, then by chapters), and how many files it has.
// Made once for a catalog, which is made again when a book comes, changes or goes
const books = new WeakMap<Entry[], { newest: Entry[]; versions: Map<string, number> }>();
function booksOf(entries: Entry[]) {
  let made = books.get(entries);
  if (made) return made;
  let best = new Map<string, Entry>();
  let versions = new Map<string, number>();
  for (let entry of entries) {
    versions.set(entry.same, (versions.get(entry.same) ?? 0) + 1);
    let kept = best.get(entry.same);
    if (!kept || entry.date > kept.date || (entry.date === kept.date && entry.chapters > kept.chapters)) best.set(entry.same, entry);
  }
  made = { newest: [...best.values()], versions };
  books.set(entries, made);
  return made;
}
// the books being read, one to a title: the file read last
function readOf(entries: Entry[], progress: Record<string, Progress>) {
  let best = new Map<string, Entry>();
  for (let entry of entries) {
    let at = readAt(progress[entry.id]);
    if (!at) continue;
    let kept = best.get(entry.same);
    if (!kept || at > readAt(progress[kept.id])) best.set(entry.same, entry);
  }
  return [...best.values()];
}

export function findBooks(entries: Entry[], progress: Record<string, Progress>, query: Query = {}): Listing {
  let words = fold(query.q ?? '').split(/\s+/).filter(Boolean);
  let tags = (query.tags ?? []).map(fold);
  let sort = query.sort ?? 'latest';
  let { newest, versions } = booksOf(entries);
  let same = query.title != null ? fold(query.title) : null;
  let pool = same != null ? entries.filter(entry => entry.same === same)
    : query.every ? entries
    : sort === 'read' ? readOf(entries, progress)
    : newest;
  let found = pool.filter(entry => words.every(word => entry.words.includes(word))
    && tags.every(tag => entry.tagKeys.includes(tag))
    && within(entry.size, query.size) && within(entry.chapters, query.chapters)
    && (sort !== 'read' || readAt(progress[entry.id]) > 0));
  let seed = query.seed ?? 0;
  let keys = {
    latest: (e: Entry) => e.date,
    read: (e: Entry) => readAt(progress[e.id]),
    size: (e: Entry) => e.size,
    chapters: (e: Entry) => e.chapters,
    random: (e: Entry) => shuffled(e.id, seed),
  };
  let descending = query.order ? query.order === 'desc' : sort !== 'title' && sort !== 'random';
  if (words.length && !query.sort) {
    // what was typed as it was typed: the titles it begins first, then those that say it, then
    // the ones that have its words, each by title
    let phrase = words.join(' ');
    let rank = (entry: Entry) => {
      let title = fold(entry.title);
      return title.startsWith(phrase) ? 0 : title.includes(phrase) ? 1 : entry.words.includes(phrase) ? 2 : 3;
    };
    let ranked = new Map(found.map(entry => [entry, rank(entry)]));
    found.sort((a, z) => ranked.get(a)! - ranked.get(z)! || byTitle.compare(a.title, z.title));
    descending = query.order === 'desc';
  }
  else if (sort === 'title') found.sort((a, z) => byTitle.compare(a.title, z.title));
  else {
    let key = keys[sort];
    let ranked = new Map(found.map(entry => [entry, key(entry)]));
    found.sort((a, z) => ranked.get(a)! - ranked.get(z)! || byTitle.compare(a.title, z.title));
  }
  if (descending) found.reverse();
  let offset = Math.max(0, Math.floor(query.offset ?? 0));
  let limit = Math.min(MOST, Math.max(1, Math.floor(query.limit ?? PAGE)));
  return {
    total: found.length,
    offset,
    books: found.slice(offset, offset + limit).map(({ words: _words, tagKeys: _tagKeys, same: key, ...shown }) => ({
      ...shown,
      ...(progress[shown.id] && { read: progress[shown.id] }),
      ...((versions.get(key) ?? 1) > 1 && { versions: versions.get(key) }),
    })),
  };
}

// the tags most books have (a book of many files counted once), each as it is written most often
export function topTags(entries: Entry[], limit = 40): TagCount[] {
  let counted = new Map<string, { count: number; spellings: Map<string, number> }>();
  for (let entry of booksOf(entries).newest) {
    entry.tags.forEach((tag, k) => {
      let key = entry.tagKeys[k];
      let tally = counted.get(key) ?? counted.set(key, { count: 0, spellings: new Map() }).get(key)!;
      tally.count++;
      tally.spellings.set(tag, (tally.spellings.get(tag) ?? 0) + 1);
    });
  }
  return [...counted.values()]
    .sort((a, z) => z.count - a.count)
    .slice(0, limit)
    .map(({ count, spellings }) => ({ tag: [...spellings].sort((a, z) => z[1] - a[1])[0][0], count }));
}

// ---- a query in a url, and back
const SORTS: Sort[] = ['latest', 'read', 'title', 'size', 'chapters', 'random'];
const rangeText = ([min, max]: Range) => `${min ?? ''}-${max ?? ''}`;
const rangeOf = (text: string | null): Range | undefined => {
  let found = /^(\d*)-(\d*)$/.exec(text ?? '');
  if (!found || (!found[1] && !found[2])) return undefined;
  return [found[1] ? Number(found[1]) : null, found[2] ? Number(found[2]) : null];
};
export function queryString(query: Query) {
  let params = new URLSearchParams();
  if (query.q?.trim()) params.set('q', query.q.trim());
  for (let tag of query.tags ?? []) params.append('tag', tag);
  if (query.size) params.set('size', rangeText(query.size));
  if (query.chapters) params.set('chapters', rangeText(query.chapters));
  if (query.title != null) params.set('title', query.title);
  if (query.every) params.set('every', '1');
  for (let key of ['sort', 'order', 'seed', 'offset', 'limit'] as const) {
    if (query[key] != null) params.set(key, String(query[key]));
  }
  return params.toString();
}
export function queryOf(params: URLSearchParams): Query {
  let number = (key: string) => (params.get(key) != null && Number.isFinite(Number(params.get(key))) ? Number(params.get(key)) : undefined);
  let sort = params.get('sort') as Sort | null;
  let order = params.get('order');
  return {
    q: params.get('q') ?? undefined,
    tags: params.getAll('tag').filter(Boolean),
    size: rangeOf(params.get('size')),
    chapters: rangeOf(params.get('chapters')),
    title: params.get('title') ?? undefined,
    every: params.get('every') === '1' || undefined,
    sort: sort && SORTS.includes(sort) ? sort : undefined,
    order: order === 'asc' || order === 'desc' ? order : undefined,
    seed: number('seed'),
    offset: number('offset'),
    limit: number('limit'),
  };
}
