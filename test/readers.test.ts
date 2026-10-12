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
    let readers = createReaders({ count: 2, idle: 100 });
    try {
      let read = await Promise.all(files.map(file => readers.read(file)));
      assert.deepEqual(read.map(book => book.chapters.at(-1)!.title), ['Chương 3: Tiêu đề 3', 'Chương 3: Tiêu đề 3', 'Chương 3: Tiêu đề 3']);
      assert.equal(readers.running(), 2);
      await wait(400);
      assert.equal(readers.running(), 0);
      // and one again for the next
      let { text } = await readers.text(files[1]);
      assert.equal(text, normalizeFileContent(bookText('Quách Tĩnh')));
      assert.equal(readers.running(), 1);
    } finally {
      await readers.close();
    }
    assert.equal(readers.running(), 0);
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
