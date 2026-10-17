// The full text of the books into the index, in a process of its own with a connection of its
// own (see indexer.ts): the book asked for first, then every book not yet indexed under this
// index, one after another, in writes of a few MB so none holds the database long. With none
// left it says it is idle, and waits to be told of more, or ended.
import fs from 'node:fs';
import path from 'node:path';
import { createStore, INDEX_VERSION } from './store.ts';
import type { ChapterRow } from './store.ts';
import { normalizeFileContent } from '../src/parser.ts';
import { rawOffsets, rawText } from './raw.ts';

// what the indexer tells: a book indexed, or one that could not be, or that it has nothing left
// to do, having heard so many messages
export type Told = { indexed: string } | { failed: string; error: string } | { idle: number };

const given: { database: string; roots: [string, string][] } = JSON.parse(process.argv[2]);
const store = createStore(given.database);
const roots = new Map<string, string>(given.roots);
const BATCH = 2e6;   // characters of text a write takes in
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

function index(id: string) {
  let book = store.book(id);
  if(!book || book.indexed === INDEX_VERSION) return false;
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
  // a book stopped in the middle of is taken up where it was left; one indexed under another
  // index, or not begun, is begun
  let from = 0;
  if(book.indexing === INDEX_VERSION) from = store.indexedTo(id);
  else store.startIndexing(book, INDEX_VERSION);
  let batch = [];
  let size = 0;
  for(let block of blocksOf(text, chapters, from)) {
    let body = text.slice(block.offset, block.end);
    batch.push({ ...block, body });
    size += body.length;
    if(size < BATCH) continue;
    // the book read again meanwhile: it is to be indexed as it is now
    if(!store.indexBlocks(book, batch)) return false;
    batch = [];
    size = 0;
  }
  if(!store.indexBlocks(book, batch)) return false;
  store.markIndexed(book, INDEX_VERSION);
  return true;
}

async function run() {
  for(;;) {
    let id = first.shift() ?? store.toIndex(INDEX_VERSION, passed.size + 1).find(next => !passed.has(next));
    if(!id) {
      // nothing left: until a book comes in (or the indexer is ended)
      tell({ idle: heard });
      await new Promise<void>(resolve => { wake = resolve; });
      wake = null;
      continue;
    }
    try {
      if(index(id)) tell({ indexed: id });
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
