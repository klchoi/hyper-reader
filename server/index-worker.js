// The full text of the books into the index, on a thread of its own with a connection of its
// own (see indexer.js): the book asked for first, then every book not yet indexed under this
// parser, one after another, in writes of a few MB so none holds the database long.
const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { createStore } = require('./store.js');
const { loadParser } = require('../lib/parser.js');

const parser = loadParser();
const store = createStore(workerData.database);
const roots = new Map(workerData.roots);
const BATCH = 2e6;   // characters of text a write takes in

let first = [];          // books asked for, before the rest
let passed = new Set();  // books whose file is not as kept: the next scan reads them again
let wake = null;
parentPort.on('message', ({ first: id }) => {
  if(id) {
    first = [id, ...first.filter(f => f !== id)];
    passed.delete(id);
  }
  wake?.();
});

function index(id) {
  let book = store.book(id);
  if(!book || book.parser !== parser.PARSER_VERSION || book.indexed === parser.PARSER_VERSION) return false;
  let file = path.join(roots.get(book.root) ?? '', book.path);
  let stat = fs.statSync(file, { throwIfNoEntry: false });
  if(!stat || stat.size !== book.size || stat.mtimeMs !== book.mtime) {
    passed.add(id);
    return false;
  }
  let text = parser.normalizeFileContent(fs.readFileSync(file, 'utf8'));
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
  store.markIndexed(book, parser.PARSER_VERSION);
  return true;
}

async function run() {
  for(;;) {
    let id = first.shift() ?? store.toIndex(parser.PARSER_VERSION, passed.size + 1).find(next => !passed.has(next));
    if(!id) {
      // nothing left: until a book comes in, or a minute has gone
      await new Promise(resolve => {
        wake = resolve;
        setTimeout(resolve, 60000);
      });
      wake = null;
      continue;
    }
    try {
      if(index(id)) parentPort.postMessage({ indexed: id });
    } catch(error) {
      passed.add(id);
      parentPort.postMessage({ failed: id, error: String(error.message) });
    }
    // a book asked for meanwhile is let in
    await new Promise(resolve => setImmediate(resolve));
  }
}
run();
