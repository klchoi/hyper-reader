// How the page reads a book in a worker, run here with node's worker threads standing in for
// the browser's: they get the parser's own script, as the page's worker does.
const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Worker: NodeWorker } = require('node:worker_threads');
const { SOURCES } = require('../lib/parser.js');
const { loadParser } = require('../src/load-parser.js');

// the page's own code for it, marked off in src/main.js, and the texts it is handed
const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main.js'), 'utf8');
const between = (a, b) => main.slice(main.indexOf(a), main.indexOf(b));
const [parserSource, bookSource] = SOURCES.map(source => fs.readFileSync(source, 'utf8'));

const story = (count) => Array.from({ length: count }, (_, k) => `Nàng đi qua núi ${k % 7 ? 'rừng' : 'suối'} và nhớ chuyện cũ rất lâu trước kia.`).join('\n\n');
const text = ['Sách thử tác giả: ai đó', ...[1, 2, 3].map(n => `Chương ${n}: Tiêu đề ${n}\n\n${story(8)}`)].join('\n\n');
const file = { name: 'Sách thử (1-3 chương).txt' };

// a page: `Worker` and its friends as the browser has them, over node's threads
function page({ failing = false, missing = false } = {}) {
  let sources = new Map();
  class Blob { constructor([source]) { this.source = source; } }
  let URL = { createObjectURL(blob) { let url = `blob:${sources.size}`; sources.set(url, blob.source); return url; } };
  // a worker's own scope: `self`, and messages in and out
  let scope = `
    const { parentPort } = require('node:worker_threads');
    globalThis.self = globalThis;
    globalThis.postMessage = (message) => parentPort.postMessage(message);
    parentPort.on('message', (data) => globalThis.onmessage({ data }));
  `;
  class Worker {
    constructor(url) {
      if(failing) { setTimeout(() => this.onerror?.({}), 0); return; }
      this.thread = new NodeWorker(scope + '\n' + sources.get(url), { eval: true });
      this.thread.on('message', (data) => this.onmessage?.({ data }));
      this.thread.on('error', () => this.onerror?.({}));
    }
    postMessage(message) { this.thread?.postMessage(message); }
    terminate() { this.thread?.terminate(); }
  }
  let said = [];
  let console = { log() {}, info: (...message) => said.push(message.join(' ')), group() {}, groupEnd() {} };
  let code = `${between('// @source:begin', '// @source:end')}\n${between('// @worker:begin', '// @worker:end')}\nreturn { readBook, stop: () => parserWorker?.terminate() };`;
  // `Worker` left out is a browser that has none
  let loaded = new Function('Worker', 'URL', 'Blob', 'console', 'parserSource', 'bookSource', 'loadParser', code)(
    missing ? undefined : Worker, URL, Blob, console, parserSource, bookSource, loadParser,
  );
  return { ...loaded, said };
}

describe('reading a book in a worker', () => {
  let stop;
  afterEach(() => stop?.());
  it('gives the chapters the page would have made', async () => {
    let { readBook, stop: s, said } = page();
    stop = s;
    let book = await readBook(file, text);
    assert.deepEqual(book.chapters.map(c => c.title), ['Sách thử', 'Chương 1: Tiêu đề 1', 'Chương 2: Tiêu đề 2', 'Chương 3: Tiêu đề 3']);
    assert.equal(book.name, 'Sách thử');
    assert.equal(book.id, 'sach-thu');
    assert.deepEqual(said, ['Chapters of "Sách thử": read in a worker']);
  });
  it('reads several books at once, each to its own result', async () => {
    let { readBook, stop: s } = page();
    stop = s;
    let [a, b] = await Promise.all([readBook(file, text), readBook({ name: 'Khác.txt' }, text.replaceAll('Tiêu đề', 'Tên'))]);
    assert.ok(a.chapters[1].title.includes('Tiêu đề'));
    assert.ok(b.chapters[1].title.includes('Tên'));
  });
  it('reads the book itself where a worker cannot be made', async () => {
    let { readBook, stop: s, said } = page({ missing: true });
    stop = s;
    let book = await readBook(file, text);
    assert.equal(book.chapters.length, 4);
    assert.ok(said.some(m => m.includes('read in the page')));
  });
  it('reads the book itself when the worker fails', async () => {
    let { readBook, stop: s, said } = page({ failing: true });
    stop = s;
    let book = await readBook(file, text);
    assert.equal(book.chapters.length, 4);
    assert.ok(said.some(m => m.includes('the worker could not run')));
  });
});
