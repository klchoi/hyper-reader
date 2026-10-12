// The full text of the books into the index, on a thread of its own with a connection of its
// own (see indexer.ts): the book asked for first, then every book not yet indexed under this
// parser, one after another, in writes of a few MB so none holds the database long.
import { parentPort, workerData } from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import { createStore } from './store.ts';
import { normalizeFileContent } from '../src/parser.ts';
import { PARSER_VERSION } from '../src/book.ts';

// what the indexer tells: a book indexed, or one that could not be
export type Told = { indexed: string } | { failed: string; error: string };

const store = createStore(workerData.database);
const roots = new Map<string, string>(workerData.roots);
const BATCH = 2e6;   // characters of text a write takes in
const tell = (told: Told) => parentPort!.postMessage(told);

let first: string[] = [];          // books asked for, before the rest
let passed = new Set<string>();    // books whose file is not as kept: the next scan reads them again
let wake: (() => void) | null = null;
parentPort!.on('message', ({ first: id }: { first?: string }) => {
  if(id) {
    first = [id, ...first.filter(f => f !== id)];
    passed.delete(id);
  }
  wake?.();
});

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
      // nothing left: until a book comes in, or a minute has gone
      await new Promise<void>(resolve => {
        wake = resolve;
        setTimeout(resolve, 60000);
      });
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
run();
