// How the page reads a book in a worker, run here with node's worker threads standing in for
// the browser's: they run the page's own worker script (src/parser-worker.ts).
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { createReader } from '../src/reading.ts';
import type { MakeWorker } from '../src/reading.ts';

const story = (count: number) => Array.from({ length: count }, (_, k) => `Nàng đi qua núi ${k % 7 ? 'rừng' : 'suối'} và nhớ chuyện cũ rất lâu trước kia.`).join('\n\n');
const text = ['Sách thử tác giả: ai đó', ...[1, 2, 3].map(n => `Chương ${n}: Tiêu đề ${n}\n\n${story(8)}`)].join('\n\n');
const file = { name: 'Sách thử (1-3 chương).txt' };

// a worker's own scope, as the browser gives it: `onmessage` to set, and `postMessage`. The
// script is loaded once the scope is there, and is given what came meanwhile
const scope = `
  const { parentPort } = require('node:worker_threads');
  globalThis.onmessage = null;
  globalThis.postMessage = (message) => parentPort.postMessage(message);
  const loaded = import(${JSON.stringify(new URL('../src/parser-worker.ts', import.meta.url).href)});
  parentPort.on('message', async (data) => { await loaded; globalThis.onmessage({ data }); });
`;

// a page: its reader, with a worker on one of node's threads
function page({ failing = false, missing = false } = {}) {
  // the workers made, and those let go
  let workers = { made: 0, ended: 0 };
  let makeWorker: MakeWorker = (answered, failed) => {
    if(failing) {
      setTimeout(failed, 0);
      return { postMessage() {}, terminate() {} };
    }
    workers.made++;
    let thread = new Worker(scope, { eval: true });
    thread.on('message', answered);
    thread.on('error', () => failed());
    return { postMessage: (job) => thread.postMessage(job), terminate: () => { workers.ended++; thread.terminate(); } };
  };
  let said: string[] = [];
  let console = { info: (...message: unknown[]) => { said.push(message.join(' ')); } };
  // no `makeWorker` is a browser that has no workers
  let reader = createReader({ makeWorker: missing ? undefined : makeWorker, console });
  return { ...reader, said, workers };
}

describe('reading a book in a worker', () => {
  let stop: (() => void) | undefined;
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
  it('lets its worker go once it has read all it was given, and makes another for the next', async () => {
    let { readBook, stop: s, workers } = page();
    stop = s;
    await Promise.all([readBook(file, text), readBook({ name: 'Khác.txt' }, text)]);
    assert.deepEqual(workers, { made: 1, ended: 1 });
    let book = await readBook(file, text);
    assert.equal(book.chapters.length, 4);
    assert.deepEqual(workers, { made: 2, ended: 2 });
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
