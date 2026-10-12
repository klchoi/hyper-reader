// The full text of the books into the index, in a process of its own with a connection of its
// own (see indexer.ts): the book asked for first, then every book not yet indexed under this
// parser, one after another, in writes of a few MB so none holds the database long. With none
// left it says it is idle, and waits to be told of more, or ended.
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './store.ts';
import { normalizeFileContent } from '../src/parser.ts';
import { PARSER_VERSION } from '../src/book.ts';

// what the indexer tells: a book indexed, or one that could not be, or that it has nothing left
// to do, having heard so many messages
export type Told = { indexed: string } | { failed: string; error: string } | { idle: number };

const given: { database: string; roots: [string, string][] } = JSON.parse(process.argv[2]);
const store = createStore(given.database);
const roots = new Map<string, string>(given.roots);
const BATCH = 2e6;   // characters of text a write takes in
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

function index(id: string) {
  let book = store.book(id);
  if(!book || book.parser !== PARSER_VERSION || book.indexed === PARSER_VERSION) return false;
  let file = path.join(roots.get(book.root) ?? '', book.path);
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if(!stat || stat.size !== book.size || stat.mtimeMs !== book.mtime) {
    passed.add(id);
    return false;
  }
  let text = normalizeFileContent(fs.readFileSync(file, 'utf8'));
  let batch = [];
  let size = 0;
  for(let chapter of store.chapters(id)) {
    let body = text.slice(chapter.offset, chapter.end);
    batch.push({ rowid: chapter.rowid, title: chapter.title, body });
    size += body.length;
    if(size < BATCH) continue;
    store.indexChapters(batch);
    batch = [];
    size = 0;
  }
  store.indexChapters(batch);
  store.markIndexed(book, PARSER_VERSION);
  return true;
}

async function run() {
  for(;;) {
    let id = first.shift() ?? store.toIndex(PARSER_VERSION, passed.size + 1).find(next => !passed.has(next));
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
