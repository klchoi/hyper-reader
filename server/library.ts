// The books the server keeps: those of the libraries it is given (folders of .txt files, read
// where they are) and those dropped on the page (kept in <data>/uploads, a library of its own).
// A scan finds what came, changed or went in the libraries since the last, and reads only that;
// the full text is indexed behind it, a book opened first.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createStore, plain } from './store.ts';
import type { BookRow, ChapterRow } from './store.ts';
import { createReaders } from './readers.ts';
import type { ReadText } from './read-worker.ts';
import { createIndexer } from './indexer.ts';
import { slug } from '../src/parser.ts';
import { PARSER_VERSION } from '../src/book.ts';
import type { BookRecord } from '../src/book.ts';
import { entryOf, findBooks, topTags } from '../src/catalog.ts';
import type { Entry, Progress, Query } from '../src/catalog.ts';

const UPLOADS = 'uploads';

// a book's id: its name, readable, and its place (library and path), which makes it its own;
// two files may well give one name (`Đại dâm hiệp (1-2 bộ 183 chương ...)` and `... (1)`)
const hashOf = (text: string) => crypto.createHash('sha1').update(text).digest('hex').slice(0, 8);

// what the page shows of a chapter
function listedOf(chapter: Pick<ChapterRow, 'id' | 'title' | 'offset' | 'grp' | 'part_of' | 'part_text'>) {
  return {
    id: chapter.id, title: chapter.title, offset: chapter.offset,
    ...(chapter.grp != null && { group: chapter.grp }),
    ...(chapter.part_of != null && { part: { of: chapter.part_of, text: chapter.part_text ?? '' } }),
  };
}

// The text folded as search folds it (see `plain` in store.ts), one character for one, so a
// place found in the one is the same place in the other
let folded = new Map<string, string>();
function plainKeepingPlaces(text: string) {
  let out = '';
  for(let ch of text) {
    let f = folded.get(ch);
    if(f === undefined) {
      f = plain(ch);
      if(f.length !== ch.length) f = ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch;
      folded.set(ch, f);
    }
    out += f;
  }
  return out;
}
const isLetter = (ch?: string) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
// what was asked with its accents is found with them: `Hoàng Dung` is not `hoảng dùng`. The
// index finds both, so what it finds is held to the accents where they can be read
const accented = (q: string) => plain(q) !== q.toLowerCase().normalize();
const asked = (q: string) => q.trim().replace(/\s+/g, ' ').toLowerCase().normalize();

// an error the asker is told of, with the status it answers
const refusal = (message: string, status: number) => Object.assign(new Error(message), { status });

export type LibraryDir = { name: string; dir: string };

export function createLibrary({ data, libraries = [] }: { data: string; libraries?: LibraryDir[] }) {
  let uploads = path.join(data, UPLOADS);
  fs.mkdirSync(uploads, { recursive: true });
  let database = path.join(data, 'library.db');
  let store = createStore(database);
  let roots = new Map<string, string>([[UPLOADS, uploads], ...libraries.map(({ name, dir }): [string, string] => [name, path.resolve(dir)])]);
  let readers = createReaders();
  let indexer = createIndexer({ database, roots });
  // what was left unindexed when the server last stopped
  indexer.nudge();
  let fileOf = (row: BookRow) => path.join(roots.get(row.root) ?? '', row.path);
  // every book as the library is browsed (see src/catalog.ts), made again once a book came,
  // changed or went
  let catalog: Entry[] | null = null;
  let catalogued = () => catalog ??= store.books().map(row => entryOf({
    id: row.id, path: row.path, size: row.size, chapters: row.chapterCount, date: Math.round(row.mtime), deletable: row.root === UPLOADS,
  }));
  let forget = (id: string) => {
    store.forgetBook(id);
    texts.delete(id);
    catalog = null;
  };
  let idOf = (root: string, rel: string, name: string) => `${slug(name).slice(0, 48) || 'book'}-${hashOf(`${root}/${rel.normalize()}`)}`;

  // the text the offsets of a book count in, kept for the book read last only: a big one is tens
  // of MB, which the server keeps once it has held them. Null when the file is not the one read
  // (changed, or gone): the book is to be read again
  let texts = new Map<string, ReadText>();
  async function textOf(row: BookRow) {
    let kept = texts.get(row.id);
    if(kept?.mtime === row.mtime && kept.size === row.size) return kept.text;
    let read;
    try {
      read = await readers.text(fileOf(row));
    } catch(error) {
      if((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
    if(read.size !== row.size || read.mtime !== row.mtime) return null;
    texts.clear();
    texts.set(row.id, read);
    return read.text;
  }

  // a file of a library read, and kept; its id
  async function readBook(root: string, rel: string) {
    let read = await readers.read(path.join(roots.get(root)!, rel));
    let id = idOf(root, rel, read.name);
    store.keepBook({ id, root, path: rel, ...read });
    texts.delete(id);
    catalog = null;
    indexer.nudge();
    return id;
  }

  // the book as the page knows it: its record, with its chapters
  let recordOf = (row: BookRow): BookRecord => ({
    id: row.id, name: row.name, description: row.description ?? undefined, parser: row.parser,
    chapters: store.chapters(row.id).map(listedOf),
  });

  // ---- scanning
  type Scan = { running: boolean; startedAt?: string; finishedAt?: string; files?: number; toRead?: number; read?: number; failed?: number; removed?: number };
  let scan: Scan = { running: false };
  let scanning: Promise<void> | null = null;
  let closing: Promise<void> | null = null;
  // every .txt file under a folder, with its size and time
  async function filesUnder(dir: string) {
    let entries = await fs.promises.readdir(dir, { recursive: true, withFileTypes: true }).catch(() => []);
    let found: { rel: string; size: number; mtime: number }[] = [];
    for(let entry of entries) {
      if(!entry.isFile() || !/\.txt$/i.test(entry.name)) continue;
      let file = path.join(entry.parentPath, entry.name);
      let stat = await fs.promises.stat(file).catch(() => null);
      if(stat) found.push({ rel: path.relative(dir, file), size: stat.size, mtime: stat.mtimeMs });
    }
    return found;
  }
  async function rescan() {
    let now = { running: true, startedAt: new Date().toISOString(), files: 0, toRead: 0, read: 0, failed: 0, removed: 0 };
    scan = now;
    let toRead: { root: string; rel: string }[] = [];
    for(let [root, dir] of roots) {
      let files = await filesUnder(dir);
      now.files += files.length;
      let known = new Map(store.booksIn(root).map(row => [row.path, row]));
      for(let file of files) {
        let had = known.get(file.rel);
        known.delete(file.rel);
        let same = had && had.size === file.size && had.mtime === file.mtime && had.parser === PARSER_VERSION;
        if(!same) toRead.push({ root, rel: file.rel });
      }
      // a book whose file is gone goes; where it was left and its names stay, for it to come back to
      for(let gone of known.values()) {
        forget(gone.id);
        now.removed++;
      }
    }
    now.toRead = toRead.length;
    await Promise.all(toRead.map(({ root, rel }) => readBook(root, rel).then(
      () => { now.read++; },
      (error) => {
        now.failed++;
        console.error('Not read:', root, rel, error.message);
      },
    )));
    scan = { ...now, running: false, finishedAt: new Date().toISOString() };
  }

  let library = {
    roots,
    // ---- the page's backend
    settings: async () => store.settings(),
    saveSettings: async (settings: Record<string, unknown>) => store.saveSettings(settings),
    progress: async () => store.progress(),
    saveProgress: async (id: string, record: unknown) => store.saveProgress(id, record),
    names: async (id: string) => store.names(id),
    saveNames: async (id: string, text: string) => store.saveNames(id, text),
    // the books asked for, a page of them (see src/catalog.ts); a book of a library is the
    // reader's own file, and only those dropped on the page can be deleted from it
    books: async (query: Query = {}) => findBooks(catalogued(), store.progress() as Record<string, Progress>, query),
    // the tags most books have
    tags: async (limit = 40) => topTags(catalogued(), limit),
    // a book dropped on the page, kept with the uploads under its own name: one of that name
    // already there is the same book, written over
    async addBook({ name, text }: { name?: unknown; text?: unknown }) {
      let file = typeof name === 'string' ? path.basename(name) : '';
      if(!/\.txt$/i.test(file) || file !== name || typeof text !== 'string') {
        throw refusal(`not a book: ${name}`, 400);
      }
      let temporary = path.join(uploads, `.${file}.${process.pid}.tmp`);
      await fs.promises.writeFile(temporary, text);
      await fs.promises.rename(temporary, path.join(uploads, file));
      return library.book(await readBook(UPLOADS, file));
    },
    // a book's record: read again first if an older parser read it, and indexed first
    async book(id: string): Promise<BookRecord | null> {
      let row = store.book(id);
      if(!row) return null;
      if(row.parser !== PARSER_VERSION) return library.rereadBook(id);
      if(row.indexed !== PARSER_VERSION) indexer.first(id);
      return recordOf(row);
    },
    async chapter(id: string, chapterId: string, again = true): Promise<(ReturnType<typeof listedOf> & { content: string }) | null> {
      let row = store.book(id);
      let chapter = row && store.chapters(id).find(c => c.id === chapterId);
      if(!row || !chapter) return null;
      let text = await textOf(row);
      // the file changed since it was read: read again, and the chapter asked of that
      if(text == null) return again && await library.rereadBook(id) ? library.chapter(id, chapterId, false) : null;
      return { ...listedOf(chapter), content: text.slice(chapter.offset, chapter.end).trim() };
    },
    async rereadBook(id: string): Promise<BookRecord | null> {
      let row = store.book(id);
      if(!row) return null;
      if(!fs.existsSync(fileOf(row))) {
        forget(id);
        return null;
      }
      return recordOf(store.book(await readBook(row.root, row.path))!);
    },
    async deleteBook(id: string) {
      let row = store.book(id);
      if(!row) return;
      if(row.root !== UPLOADS) throw refusal('a book of a library is the reader\'s own file, and is not deleted from here', 403);
      await fs.promises.rm(fileOf(row), { force: true });
      forget(id);
    },

    // ---- the libraries
    // a scan, if none is going; its state
    scan() {
      scanning ??= rescan().finally(() => { scanning = null; });
      return library.status();
    },
    scanned: (): Promise<void> => scanning ?? Promise.resolve(),
    status: () => ({
      libraries: [...roots.keys()].filter(root => root !== UPLOADS),
      books: store.indexCount(PARSER_VERSION).total,
      scan,
      index: store.indexCount(PARSER_VERSION),
    }),

    // ---- search
    // the characters named `q` (or a name beginning so), each with the books they are in: one
    // character to a name, however it is cased, but not however it is accented
    characters(q: string) {
      if(!plain(q).trim()) return [];
      let people = new Map<string, { name: string; mentions: number; books: { id: string; name: string; mentions: number }[] }>();
      for(let { name, mentions, bookId, bookName } of store.characters(q)) {
        if(accented(q) && !name.toLowerCase().normalize().startsWith(asked(q))) continue;
        let key = name.toLowerCase();
        let person = people.get(key) ?? people.set(key, { name, mentions: 0, books: [] }).get(key)!;
        person.mentions += mentions;
        person.books.push({ id: bookId, name: bookName, mentions });
      }
      return [...people.values()].sort((a, z) => z.mentions - a.mentions).slice(0, 20);
    },
    // what says `q`: the books (and how many of their chapters), or in one book, every place it
    // is said, with the words around it. Only what is indexed is found
    async search(q: string, bookId?: string | null) {
      let words = plain(q).trim().replace(/\s+/g, ' ');
      if(!words) return bookId ? { indexed: true, mentions: [] } : [];
      let phrase = `"${words.replaceAll('"', '""')}"`;
      if(!bookId) return store.booksSaying(phrase);
      let row = store.book(bookId);
      if(!row) return null;
      let indexed = row.indexed === PARSER_VERSION;
      if(!indexed) indexer.first(bookId);
      let chapters = store.chaptersSaying(phrase, bookId);
      // (a file changed since it was read says nothing, until it is read again)
      let text = chapters.length ? await textOf(row) ?? '' : '';
      let exact = accented(q) ? asked(q) : null;
      // every place counted, the first 500 told with the words around them: a little before,
      // so the place itself is in sight, and more after
      let mentions: { chapterId: string; title: string; offset: number; before: string; match: string; after: string }[] = [];
      let total = 0;
      for(let chapter of chapters) {
        let said = text.slice(chapter.offset, chapter.end);
        let plainSaid = plainKeepingPlaces(said);
        for(let at = plainSaid.indexOf(words); at >= 0; at = plainSaid.indexOf(words, at + 1)) {
          let end = at + words.length;
          if(isLetter(plainSaid[at - 1]) || isLetter(plainSaid[end])) continue;
          let match = said.slice(at, end);
          if(exact && match.toLowerCase().normalize() !== exact) continue;
          total++;
          if(mentions.length >= 500) continue;
          let before = said.slice(Math.max(0, at - 40), at).replace(/^\S*\s/, '').replace(/\s+/g, ' ');
          let after = said.slice(end, end + 100).replace(/\s\S*$/, '').replace(/\s+/g, ' ');
          mentions.push({ chapterId: chapter.id, title: chapter.title, offset: chapter.offset + at, before, match, after });
        }
      }
      return { indexed, total, mentions };
    },

    // the processes it has at work: readers, and the indexer
    running: () => ({ readers: readers.running(), indexer: indexer.running() }),

    // once, however often asked
    close(): Promise<void> {
      closing ??= (async () => {
        await scanning?.catch(() => {});
        await Promise.all([readers.close(), indexer.close()]);
        store.close();
      })();
      return closing;
    },
  };
  return library;
}

export type Library = ReturnType<typeof createLibrary>;
