// The full text of the books into the index, in a process of its own with connections of its own
// (see indexer.ts): the book asked for first, then every book of library.db not indexed, one
// after another, in writes of 16 MB. It writes the index only (index-store.ts), which nothing
// else writes, and library.db only for a book read before its chapters were kept to its file's
// text. With none left it forgets the books gone from library.db, says it is idle, and waits to
// be told of more, or ended.
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './store.ts';
import type { ChapterRow } from './store.ts';
import { createIndexStore, createSearch } from './index-store.ts';
import { normalizeFileContent } from '../src/parser.ts';
import { rawOffsets, rawText } from './raw.ts';

// what the indexer tells: a book indexed, or one that could not be, or that it has nothing left
// to do, having heard so many messages
export type Told = { indexed: string } | { failed: string; error: string } | { idle: number };

const given: { database: string; index: string; roots: [string, string][] } = JSON.parse(process.argv[2]);
const store = createStore(given.database);
const index = createIndexStore(given.index);
const search = createSearch(given.database, given.index);
const roots = new Map<string, string>(given.roots);
// characters of text a write takes in: each write makes a piece of the index the next merge
// writes again, so few big ones write least (of 400 MB of text, 2 MB writes made 2.6 GB of
// writes, 16 MB ones 2.0 GB; 64 MB, no less again), while holding the database a second or two
const BATCH = 16e6;
const BLOCK = 16e3;  // characters of text a block takes in, at most (cut at a line's end)
const tell = (told: Told) => process.send!(told);

let first: string[] = [];          // books asked for, before the rest
let passed = new Set<string>();    // books whose file is not as kept: the next scan reads them again
let heard = 0;
let wake: (() => void) | null = null;
process.on('message', ({ first: id }: { first?: string }) => {
  heard++;
  if(id) {
    first = [id, ...first.filter(f => f !== id)];
    passed.delete(id);
  }
  wake?.();
});
// the server gone, its indexer goes too
process.on('disconnect', () => process.exit());

// a file's text cut into blocks: where its chapters begin in it now, and a long chapter at the
// end of a line; from `from` on (what is before it indexed already)
function* blocksOf(text: string, chapters: ChapterRow[], from = 0) {
  let starts = [...new Set([0, ...chapters.map(c => c.raw_offset ?? 0)])].sort((a, z) => a - z);
  for(let [n, offset] of starts.entries()) {
    let end = starts[n + 1] ?? text.length;
    for(let at = Math.max(offset, from); at < end;) {
      let cut = end - at <= BLOCK ? end : text.lastIndexOf('\n', at + BLOCK);
      if(cut <= at) cut = Math.min(end, at + BLOCK);
      yield { offset: at, end: cut };
      at = cut;
    }
  }
}

// whether a book of library.db is still as it was read (its size and time)
const still = ({ id, size, mtime }: { id: string; size: number; mtime: number }) => {
  let now = store.book(id);
  return !!now && now.size === size && now.mtime === mtime;
};

function indexBook(id: string) {
  let book = store.book(id);
  if(!book || search.isIndexed(id)) return false;
  let file = path.join(roots.get(book.root) ?? '', book.path);
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if(!stat || stat.size !== book.size || stat.mtimeMs !== book.mtime) {
    passed.add(id);
    return false;
  }
  let source = fs.readFileSync(file, 'utf8');
  let text = rawText(source);
  let chapters = store.chapters(id);
  // a book read before its chapters were kept to its file's text too
  if(chapters.some(c => c.raw_offset == null)) {
    let raw = rawOffsets(text, normalizeFileContent(source), chapters.map(c => c.offset));
    chapters = chapters.map((c, n) => ({ ...c, raw_offset: raw[n] }));
    store.keepRawOffsets(chapters as { rowid: number; raw_offset: number }[]);
  }
  // a book stopped in the middle of is taken up where it was left; one of another file, or not
  // begun, is begun
  let from = 0;
  let had = index.indexed(id);
  if(had && had.size === book.size && had.mtime === book.mtime) from = index.indexedTo(id);
  else index.begin(book);
  let batch = [];
  let size = 0;
  for(let block of blocksOf(text, chapters, from)) {
    let body = text.slice(block.offset, block.end);
    batch.push({ ...block, body });
    size += body.length;
    if(size < BATCH) continue;
    // the book read again meanwhile: it is to be indexed as it is now
    if(!still(book)) return false;
    index.indexBlocks(id, batch);
    batch = [];
    size = 0;
  }
  if(!still(book)) return false;
  index.indexBlocks(id, batch);
  index.finish(id);
  return true;
}

async function run() {
  for(;;) {
    let id = first.shift() ?? search.toIndex(passed.size + 1).find(next => !passed.has(next));
    if(!id) {
      // nothing left: what the index holds of books gone goes too, and until a book comes in (or
      // the indexer is ended)
      index.forget(search.gone());
      tell({ idle: heard });
      await new Promise<void>(resolve => { wake = resolve; });
      wake = null;
      continue;
    }
    try {
      if(indexBook(id)) tell({ indexed: id });
    } catch(error) {
      passed.add(id);
      tell({ failed: id, error: String((error as Error).message) });
    }
    // a book asked for meanwhile is let in
    await new Promise(resolve => setImmediate(resolve));
  }
}
process.send!({ ready: true });
run();
