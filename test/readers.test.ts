// The server's readers of books, in processes of their own: started for the books to read, as
// many as they may be, and ended once they have had nothing to do for a while.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createReaders } from '../server/readers.ts';
import { normalizeFileContent } from '../src/parser.ts';

const bookText = (who: string) => ['Sách thử', ...[1, 2, 3].map(n => `Chương ${n}: Tiêu đề ${n}\n\n${who} đi qua núi rừng và gặp người quen bên bờ suối.`)].join('\n\n');
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
// until `done`, or a deadline: how soon a process ends depends on the machine
const until = async (done: () => boolean) => {
  for(let tries = 0; tries < 100 && !done(); tries++) await wait(25);
  assert.ok(done());
};

describe('the readers', () => {
  let shelf: string;
  let files: string[];
  before(() => {
    shelf = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-readers-'));
    files = ['Hoàng Dung', 'Quách Tĩnh', 'Dương Quá'].map((who, k) => {
      let file = path.join(shelf, `Sách ${k} (1-3 chương).txt`);
      fs.writeFileSync(file, bookText(who));
      return file;
    });
  });
  after(() => fs.rmSync(shelf, { recursive: true, force: true }));

  it('starts as many readers as it may for the books to read, and ends them once idle', async () => {
    let readers = createReaders({ count: 3, idle: 100 });
    try {
      let reads = files.map(file => readers.read(file));
      // as many as it may, started as the jobs come: one kept for a book someone waits on
      assert.equal(readers.running(), 2);
      let read = await Promise.all(reads);
      assert.deepEqual(read.map(book => book.chapters.at(-1)!.title), ['Chương 3: Tiêu đề 3', 'Chương 3: Tiêu đề 3', 'Chương 3: Tiêu đề 3']);
      await until(() => readers.running() === 0);
      // and one again for the next
      let asked = readers.text(files[1]);
      assert.equal(readers.running(), 1);
      let { text } = await asked;
      assert.equal(text, normalizeFileContent(bookText('Quách Tĩnh')));
    } finally {
      await readers.close();
    }
    assert.equal(readers.running(), 0);
  });
  it('reads the text of a book asked for before the books waiting to be read', async () => {
    let readers = createReaders({ count: 1, idle: 100 });
    try {
      let done: string[] = [];
      let reads = files.map((file, k) => readers.read(file).then(() => { done.push(`read ${k}`); }));
      let text = readers.text(files[2]).then(() => { done.push('text'); });
      await Promise.all([...reads, text]);
      // the first read was under way already
      assert.deepEqual(done, ['read 0', 'text', 'read 1', 'read 2']);
    } finally {
      await readers.close();
    }
  });
  it('reads a book someone waits on before the books queued, once though it was queued already', async () => {
    let readers = createReaders({ count: 1, idle: 100 });
    try {
      let done: string[] = [];
      let reads = files.map((file, k) => readers.read(file).then(() => { done.push(`read ${k}`); }));
      let again = readers.read(files[2], { first: true });
      assert.equal(readers.busy(), 3);
      await Promise.all([...reads, again]);
      // the first read was under way already; the third, asked again, went before the second
      assert.deepEqual(done, ['read 0', 'read 2', 'read 1']);
    } finally {
      await readers.close();
    }
  });
  it('keeps a reader for a book someone waits on, however many books are queued', async () => {
    let readers = createReaders({ count: 2, idle: 100 });
    try {
      let reads = files.map(file => readers.read(file));
      assert.deepEqual([readers.running(), readers.busy()], [1, 3]);
      // the one kept takes it at once, the queued books still going through the other
      let waited = readers.text(files[2]);
      assert.equal(readers.running(), 2);
      await Promise.all([...reads, waited]);
    } finally {
      await readers.close();
    }
  });
  it('fails the job a reader could not do, and goes on with the next', async () => {
    let readers = createReaders({ count: 1, idle: 100 });
    try {
      await assert.rejects(readers.read(path.join(shelf, 'gone.txt')), { code: 'ENOENT' });
      assert.equal((await readers.read(files[0])).chapters.at(-1)!.title, 'Chương 3: Tiêu đề 3');
    } finally {
      await readers.close();
    }
  });
});
