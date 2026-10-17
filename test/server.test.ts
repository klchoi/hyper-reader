// The server's answers, as the page's server backend asks them: a server on a port of its own,
// keeping its books in a folder made for the test, with a library of its own to scan.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from '../server/server.ts';
import { createLibrary } from '../server/library.ts';
import { extractChapters, normalizeFileContent } from '../src/parser.ts';
import { PARSER_VERSION } from '../src/book.ts';
import { INDEX_VERSION } from '../server/store.ts';
import type { Line, Mark } from '../src/marks.ts';

const story = (count: number, who: string) => Array.from({ length: count }, (_, k) => (
  `Hôm ấy nàng đi qua núi ${k % 7 ? 'rừng' : 'suối'} và gặp ${who} bên bờ, nhớ chuyện cũ rất lâu trước kia.`
)).join('\n\n');
const bookText = (who: string) => ['Sách thử tác giả: ai đó', ...[1, 2, 3].map(n => `Chương ${n}: Tiêu đề ${n}\n\n${story(8, who)}`)].join('\n\n');
const upload = { name: 'Sách tải lên (1-3 chương).txt', size: 0, text: bookText('Quách Tĩnh') };
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('the server', () => {
  let server: ReturnType<typeof createServer>;
  let data: string, shelf: string, page: string, base: string;
  let port = () => (server.address() as AddressInfo).port;
  // the answer as the page reads it: JSON, text, or the status alone
  let call = async (method: string, route: string, body?: unknown): Promise<{ status: number; answer: any }> => {
    let sent = body !== undefined && {
      headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    };
    let response = await fetch(`${base}/api/${route}`, { method, ...sent });
    let type = response.headers.get('content-type') ?? '';
    let answer = type.startsWith('application/json') ? await response.json() : await response.text();
    return { status: response.status, answer };
  };
  type Shelved = { id: string; title: string; tags: string[]; note?: string; folder?: string; size: number; chapters: number; deletable: boolean };
  // (every file: the two copies of the book in the library, which it shows as one, are the same)
  let books = async (query = ''): Promise<Shelved[]> => (await call('GET', `books?every=1&limit=100${query}`)).answer.books;
  let bookNamed = async (title: string) => (await books()).find(book => book.title === title)!;
  // until the scan is done and every book indexed
  let settled = async () => {
    await server.library.scanned();
    for(let tries = 0; tries < 400; tries++) {
      let { index } = (await call('GET', 'library')).answer;
      if(index.done === index.total) return;
      await wait(25);
    }
    throw new Error('not indexed');
  };

  before(async () => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-test-'));
    shelf = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-shelf-'));
    fs.mkdirSync(path.join(shelf, 'nested'));
    fs.writeFileSync(path.join(shelf, 'Sách thử (1-3 chương).txt'), bookText('Hoàng Dung'));
    fs.writeFileSync(path.join(shelf, 'nested', 'Sách thử (1-3 chương).txt'), bookText('Hoàng Dung'));
    fs.writeFileSync(path.join(shelf, 'notes.md'), 'not a book');
    // a page of its own, not the one built of src/ (which the image's own try checks)
    page = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-page-')), 'index.html');
    fs.writeFileSync(page, '<!doctype html><title>Text Reader</title>');
    server = createServer({ data, libraries: [{ name: 'shelf', dir: shelf }], allowedHosts: ['Reader.example'], page });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${port()}`;
    server.library.scan();
    await settled();
  });
  after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.library.close();
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(shelf, { recursive: true, force: true });
    fs.rmSync(path.dirname(page), { recursive: true, force: true });
  });

  it('serves the page, at any place in it, and says it keeps the books', async () => {
    for(let at of ['/', '/books/sach-thu-1234abcd?at=120']) {
      assert.ok((await (await fetch(`${base}${at}`)).text()).includes('<title>Text Reader</title>'));
    }
    assert.deepEqual((await call('GET', 'hello')).answer, { backend: 'server' });
  });
  it('says the page is not built, where it is not', async () => {
    let built = fs.readFileSync(page, 'utf8');
    fs.rmSync(page);
    try {
      let response = await fetch(`${base}/books/sach-thu-1234abcd`);
      assert.equal(response.status, 503);
      assert.equal(await response.text(), 'the page is not built: npm run build');
    } finally {
      fs.writeFileSync(page, built);
    }
  });
  it('finds the books of a library, each its own by where it is', async () => {
    let found = await books();
    assert.equal(found.length, 2);
    assert.deepEqual(found.map(book => book.title), ['Sách thử', 'Sách thử']);
    assert.notEqual(found[0].id, found[1].id);
    assert.ok(found.every(book => /^sach-thu-[0-9a-f]{8}$/.test(book.id) && !book.deletable));
    assert.deepEqual(found.map(book => book.folder).sort(), ['nested', undefined]);
    let { answer: status } = await call('GET', 'library');
    assert.deepEqual(status.libraries, ['shelf']);
    assert.equal(status.scan.files, 2);
  });
  it('answers what is asked of the library, a page at a time, and the tags most books have', async () => {
    let tagged = [
      { name: 'Một (1-50 chương) (hậu cung, NTL).txt', text: bookText('A') },
      { name: 'Hai (1-3 chương kết thúc) (Hậu cung).txt', text: bookText('B') },
    ];
    let ids = [];
    for(let book of tagged) ids.push((await call('POST', 'books', book)).answer.id);
    let asked = async (query: string) => (await call('GET', `books?${query}`)).answer;
    let found = await asked('tag=h%C3%A2u%20cung&sort=title');
    assert.equal(found.total, 2);
    assert.deepEqual(found.books.map((book: Shelved) => [book.title, book.tags]), [['Hai', ['Hậu cung', 'kết thúc']], ['Một', ['hậu cung', 'NTL']]]);
    assert.equal(found.books[1].note, '1-50 chương');
    assert.deepEqual((await asked('q=mot')).books.map((book: Shelved) => book.title), ['Một']);
    assert.deepEqual((await asked('tag=ntl&tag=k%E1%BA%BFt%20th%C3%BAc')).total, 0);
    let page = await asked('sort=title&limit=2&offset=1');
    assert.deepEqual([page.total, page.offset, page.books.length], [3, 1, 2]);
    // the two files of `Sách thử` are one book
    let twice = (await asked('q=sach%20thu')).books;
    assert.deepEqual(twice.map((book: Shelved & { versions?: number }) => [book.title, book.versions]), [['Sách thử', 2]]);
    assert.equal((await asked('title=S%C3%A1ch%20th%E1%BB%AD')).total, 2);
    assert.deepEqual((await asked('sort=random&seed=7')).books.map((book: Shelved) => book.id), (await asked('sort=random&seed=7')).books.map((book: Shelved) => book.id));
    let largest = Math.max(...(await books()).map(book => book.size));
    assert.deepEqual([(await asked(`size=${largest + 1}-`)).total, (await asked(`size=-${largest}`)).total], [0, 3]);
    let { answer: tags } = await call('GET', 'tags?limit=1');
    // (as either book writes it)
    assert.deepEqual(tags.map((t: { tag: string; count: number }) => [t.tag.toLowerCase(), t.count]), [['hậu cung', 2]]);
    for(let id of ids) assert.equal((await call('DELETE', `books/${id}`)).status, 204);
  });
  it('reads a book with the page\'s parser, and cuts a chapter as it does', async () => {
    let { id } = await bookNamed('Sách thử');
    let { answer: record } = await call('GET', `books/${id}`);
    assert.equal(record.parser, PARSER_VERSION);
    assert.deepEqual(record.chapters.map((c: { title: string }) => c.title), ['Sách thử', 'Chương 1: Tiêu đề 1', 'Chương 2: Tiêu đề 2', 'Chương 3: Tiêu đề 3']);
    let parsed = extractChapters('Sách thử', normalizeFileContent(bookText('Hoàng Dung')), { name: 'Sách thử' });
    // a line to a paragraph, and the text as read only when asked for
    let { answer: chapter } = await call('GET', `books/${id}/chapters/${parsed[2].id}`);
    assert.equal(chapter.lines.map((line: Line) => line.text).join('\n'), parsed[2].content);
    assert.deepEqual([chapter.offset, chapter.length, chapter.content], [parsed[2].offset, parsed[2].content.length, undefined]);
    assert.equal((await call('GET', `books/${id}/chapters/${parsed[2].id}?raw=1`)).answer.content, parsed[2].content);
    assert.equal((await call('GET', `books/${id}/chapters/no-such-chapter`)).status, 404);
  });
  it('corrects a chapter by the names of its book, and says where they are', async () => {
    let { id } = await bookNamed('Sách thử');
    let { answer: record } = await call('GET', `books/${id}`);
    let shown = async () => (await call('GET', `books/${id}/chapters/${record.chapters[2].id}`)).answer;
    await call('PUT', `names/${id}`, 'Hoàng Dung -> Dung Nhi\n');
    let chapter = await shown();
    let [, line] = chapter.lines;
    assert.match(line.text, /gặp Dung Nhi bên bờ/);
    // (the offsets are those of the text as read, which the correction made shorter)
    assert.equal(line.offset, chapter.offset + 'Chương 2: Tiêu đề 2\n'.length);
    let marked = chapter.marks.filter((mark: Mark) => mark.at === 1);
    assert.deepEqual(marked.map((mark: Mark) => [line.text.slice(mark.start, mark.end), mark.known]), [['Dung Nhi', true]]);
    assert.deepEqual(chapter.persons[marked[0].person].ids, ['dung nhi']);
    // the list changed is the chapter marked again
    await call('PUT', `names/${id}`, '\n');
    assert.match((await shown()).lines[1].text, /gặp Hoàng Dung bên bờ/);
  });
  it('keeps the parts of a chapter as the parser gives them', async () => {
    let text = ['Sách phần tác giả: ai đó', 'Chương 1: Trước', story(8, 'A'), ...['thượng', 'trung', 'hạ'].flatMap(p => [`Chương 2: Yoga (${p})`, story(8, 'B')]), 'Chương 3: Sau', story(8, 'C')].join('\n\n');
    let { answer: record } = await call('POST', 'books', { name: 'Sách phần (1-3 chương).txt', size: 0, text });
    assert.deepEqual(record.chapters.map((c: { part?: unknown }) => c.part ?? null).slice(1), [
      null, ...['thượng', 'trung', 'hạ'].map(p => ({ of: 'Chương 2: Yoga', text: `(${p})` })), null,
    ]);
    await call('DELETE', `books/${record.id}`);
    await settled();
  });
  it('keeps a book dropped on the page with the uploads, and deletes only that', async () => {
    let { status, answer: record } = await call('POST', 'books', upload);
    assert.equal(status, 200);
    assert.ok(fs.existsSync(path.join(data, 'uploads', upload.name)));
    let kept = await bookNamed('Sách tải lên');
    assert.equal(kept.id, record.id);
    assert.ok(kept.deletable);
    let library = (await books()).find(book => !book.deletable)!;
    assert.equal((await call('DELETE', `books/${library.id}`)).status, 403);
    assert.equal((await call('DELETE', `books/${kept.id}`)).status, 204);
    assert.ok(!fs.existsSync(path.join(data, 'uploads', upload.name)));
    assert.equal((await call('GET', `books/${kept.id}`)).status, 404);
  });
  it('ends its indexer once every book is indexed, and starts it for a book read', async () => {
    let until = async (done: () => boolean) => {
      for(let tries = 0; tries < 400 && !done(); tries++) await wait(25);
      assert.ok(done());
    };
    await until(() => !server.library.running().indexer);
    // a book opened that is indexed already asks nothing of it
    let opened = (await books())[0];
    assert.equal((await call('GET', `books/${opened.id}`)).status, 200);
    assert.equal(server.library.running().indexer, false);
    let { answer: record } = await call('POST', 'books', { ...upload, name: 'Sách mới (1-3 chương).txt' });
    assert.equal(server.library.running().indexer, true);
    await settled();
    await until(() => !server.library.running().indexer);
    let { answer } = await call('GET', `search?q=${encodeURIComponent('Quách Tĩnh')}&book=${record.id}`);
    assert.equal(answer.indexed, true);
    assert.ok(answer.total > 0);
    await call('DELETE', `books/${record.id}`);
  });
  it('reads a book again when an older parser read it, or its file changed', async () => {
    let file = path.join(shelf, 'Sách thử (1-3 chương).txt');
    let { id } = (await books()).find(book => !book.folder && !book.deletable)!;
    let db = new DatabaseSync(path.join(data, 'library.db'));
    db.prepare('update books set parser = 1 where id = ?').run(id);
    db.close();
    assert.equal((await call('GET', `books/${id}`)).answer.parser, PARSER_VERSION);
    let { answer: record } = await call('GET', `books/${id}`);
    fs.writeFileSync(file, bookText('Hoàng Dung').replace('Tiêu đề 2', 'Tên mới'));
    // the chapter is asked of the book as it is now, which calls it something else
    assert.equal((await call('GET', `books/${id}/chapters/${record.chapters[2].id}`)).status, 404);
    assert.equal((await call('GET', `books/${id}`)).answer.chapters[2].title, 'Chương 2: Tên mới');
    fs.writeFileSync(file, bookText('Hoàng Dung'));
    await call('POST', `books/${id}/reread`);
    await settled();
  });
  it('leaves a book an older parser read to be read again when opened, its index kept, unless its file changed', async () => {
    await settled();
    let { id } = (await books()).find(book => !book.folder && !book.deletable)!;
    let db = new DatabaseSync(path.join(data, 'library.db'));
    let blocks = () => (db.prepare('select rowid from blocks where book_id = ? order by offset').all(id) as { rowid: number }[]).map(row => row.rowid);
    let row = () => db.prepare('select parser, indexed from books where id = ?').get(id) as { parser: number; indexed: number };
    let before = blocks();
    assert.ok(before.length > 0);
    db.prepare('update books set parser = 1 where id = ?').run(id);
    // a scan reads only what came, changed or went
    await call('POST', 'library/scan');
    await server.library.scanned();
    assert.equal((await call('GET', 'library')).answer.scan.read, 0);
    assert.equal(row().parser, 1);
    assert.equal((await call('GET', `books/${id}`)).answer.parser, PARSER_VERSION);
    assert.deepEqual([blocks(), row().indexed], [before, INDEX_VERSION]);
    // a file that changed is another matter
    let file = path.join(shelf, 'Sách thử (1-3 chương).txt');
    fs.appendFileSync(file, '\n\nThêm một câu.');
    await call('POST', `books/${id}/reread`);
    assert.deepEqual([blocks(), row().indexed], [[], 0]);
    await settled();
    assert.ok(blocks().length > 0 && blocks().every(rowid => !before.includes(rowid)));
    db.close();
    fs.writeFileSync(file, bookText('Hoàng Dung'));
    await call('POST', `books/${id}/reread`);
    await settled();
  });
  it('finds what came, changed and went in a library when scanned again', async () => {
    let gone = (await books()).find(book => book.folder === 'nested')!;
    await call('PUT', `progress/${gone.id}`, { offset: 120 });
    fs.rmSync(path.join(shelf, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(shelf, 'Mới (1-3 chương).txt'), bookText('Hoàng Dung'));
    assert.equal((await call('POST', 'library/scan')).status, 200);
    await settled();
    let { scan } = (await call('GET', 'library')).answer;
    assert.equal(scan.files, 2);
    assert.equal(scan.read, 1);
    assert.equal(scan.removed, 1);
    assert.deepEqual((await books()).map(book => book.title).sort(), ['Mới', 'Sách thử']);
    // where a book was left outlives it, for it to come back to
    assert.equal((await call('GET', 'progress')).answer[gone.id].offset, 120);
  });
  it('finds the books a character is in', async () => {
    let [person] = (await call('GET', `characters?q=${encodeURIComponent('hoang dung')}`)).answer;
    assert.equal(person.name, 'Hoàng Dung');
    assert.deepEqual(person.books.map((book: { name: string }) => book.name).sort(), ['Mới', 'Sách thử']);
    assert.ok(person.books.every((book: { mentions: number }) => book.mentions === 24));
    assert.deepEqual((await call('GET', 'characters?q=nobody')).answer, []);
  });
  it('finds what is said, in the library and in a book, however it is accented', async () => {
    let { answer: found } = await call('GET', `search?q=${encodeURIComponent('hoang dung')}`);
    assert.deepEqual(found.map((book: { name: string; chapters: number }) => [book.name, book.chapters]).sort(), [['Mới', 3], ['Sách thử', 3]]);
    let { id } = await bookNamed('Sách thử');
    let { answer: inBook } = await call('GET', `search?q=${encodeURIComponent('Hoàng dung')}&book=${id}`);
    assert.ok(inBook.indexed);
    assert.equal(inBook.mentions.length, 24);
    assert.equal(inBook.total, 24);
    let [first] = inBook.mentions;
    assert.equal(first.match, 'Hoàng Dung');
    assert.ok(first.before.endsWith('gặp '));
    let text = normalizeFileContent(bookText('Hoàng Dung'));
    assert.equal(text.slice(first.offset, first.offset + first.match.length), 'Hoàng Dung');
    assert.deepEqual((await call('GET', `search?q=dai+ca&book=${id}`)).answer.mentions, []);
  });
  it('finds what is said in a chapter too long for one block of the index', async () => {
    let long = Array.from({ length: 400 }, (_, k) => `Dòng ${k}: ${k % 50 ? 'trời mưa mãi không thôi, gió thổi qua sân vắng' : 'Lệnh Hồ Xung đứng dậy'}.`).join('\n');
    let text = ['Sách dài', 'Chương 1: Mở đầu', long, 'Chương 2: Hết', 'Lệnh Hồ Xung đi rồi.'].join('\n\n');
    let { answer: record } = await call('POST', 'books', { name: 'Sách dài (1-2 chương).txt', size: 0, text });
    await settled();
    let db = new DatabaseSync(path.join(data, 'library.db'), { readOnly: true });
    let blocks = (db.prepare('select count(*) as n from blocks where book_id = ?').get(record.id) as { n: number }).n;
    db.close();
    assert.ok(blocks > 3);
    let inBook = (await call('GET', `search?q=${encodeURIComponent('lenh ho xung')}&book=${record.id}`)).answer;
    assert.equal(inBook.total, 9);
    assert.deepEqual([...new Set(inBook.mentions.map((m: { title: string }) => m.title))], ['Chương 1: Mở đầu', 'Chương 2: Hết']);
    let found = (await call('GET', `search?q=${encodeURIComponent('lenh ho xung')}`)).answer;
    assert.deepEqual(found.map((book: { name: string; chapters: number }) => [book.name, book.chapters]), [['Sách dài', 2]]);
    await call('DELETE', `books/${record.id}`);
  });
  it('takes up a book where its indexing stopped, not from its beginning', async () => {
    let long = Array.from({ length: 400 }, (_, k) => `Dòng ${k}: ${k % 50 ? 'trời mưa mãi không thôi, gió thổi qua sân vắng' : 'Nhạc Bất Quần đứng dậy'}.`).join('\n');
    let { answer: record } = await call('POST', 'books', { name: 'Sách dở (1-1 chương).txt', size: 0, text: ['Sách dở', 'Chương 1: Mở đầu', long].join('\n\n') });
    await settled();
    let db = new DatabaseSync(path.join(data, 'library.db'));
    let blocks = () => (db.prepare('select rowid from blocks where book_id = ? order by offset').all(record.id) as { rowid: number }[]).map(row => row.rowid);
    let all = blocks();
    assert.ok(all.length > 3);
    // as an indexer stopped after two blocks leaves it
    db.prepare('delete from blocks where book_id = ? and rowid > ?').run(record.id, all[1]);
    db.prepare('update books set indexed = 0 where id = ?').run(record.id);
    let { answer: book } = await call('GET', `books/${record.id}`);
    assert.equal(book.id, record.id);
    await settled();
    let again = blocks();
    db.close();
    assert.deepEqual([again.length, again.slice(0, 2)], [all.length, all.slice(0, 2)]);
    assert.ok(again.slice(2).every(rowid => rowid > all.at(-1)!));
    assert.equal((await call('GET', `search?q=${encodeURIComponent('nhac bat quan')}&book=${record.id}`)).answer.total, 8);
    await call('DELETE', `books/${record.id}`);
  });
  it('keeps the index to the file\'s own text, and finds in it what the parser reads otherwise', async () => {
    let messy = (n: number) => Array.from({ length: 5 }, (_, k) => `\t Dòng ${k} , Dương Quá ${n % 2 ? 'đi' : 'về'}  rồi .`).join('\r\n\r\n');
    let text = ['Sách bừa', ...[1, 2, 3].map(n => `Chương ${n}  :  Tiêu đề ${n}\r\n\r\nQQ Group 712797052\r\n${messy(n)}`)].join('\r\n\r\n\r\n');
    let { answer: record } = await call('POST', 'books', { name: 'Sách bừa (1-3 chương).txt', size: 0, text });
    await settled();
    let db = new DatabaseSync(path.join(data, 'library.db'), { readOnly: true });
    let { last } = db.prepare('select max("end") as last from blocks where book_id = ?').get(record.id) as { last: number };
    let starts = (db.prepare('select raw_offset from chapters where book_id = ? order by n').all(record.id) as { raw_offset: number }[]).map(c => c.raw_offset);
    db.close();
    assert.equal(last, text.length);
    assert.deepEqual(starts.slice(1), [1, 2, 3].map(n => text.indexOf(`Chương ${n}`)));
    let inBook = (await call('GET', `search?q=${encodeURIComponent('duong qua di')}&book=${record.id}`)).answer;
    assert.equal(inBook.total, 10);
    let read = normalizeFileContent(text);
    assert.ok(inBook.mentions.every((m: { offset: number; match: string }) => read.slice(m.offset, m.offset + m.match.length) === m.match));
    let found = (await call('GET', `search?q=${encodeURIComponent('duong qua di')}`)).answer;
    assert.deepEqual(found.map((book: { name: string; chapters: number }) => [book.name, book.chapters]), [['Sách bừa', 2]]);
    await call('DELETE', `books/${record.id}`);
  });
  it('holds what is found to the accents it was asked with', async () => {
    let both = `${bookText('Hoàng Dung')}\n\nNàng hoảng dùng tay che mặt.\n\nRồi hoảng dùng chân chạy.`;
    let { answer: record } = await call('POST', 'books', { name: 'Hai cách (1-3 chương).txt', size: 0, text: both });
    await settled();
    let plain = (await call('GET', `search?q=${encodeURIComponent('hoang dung')}&book=${record.id}`)).answer;
    let accented = (await call('GET', `search?q=${encodeURIComponent('Hoàng Dung')}&book=${record.id}`)).answer;
    assert.equal(plain.total, 26);
    assert.equal(accented.total, 24);
    assert.ok(accented.mentions.every((m: { match: string }) => m.match === 'Hoàng Dung'));
    let [person] = (await call('GET', `characters?q=${encodeURIComponent('Hoàng')}`)).answer;
    assert.equal(person.name, 'Hoàng Dung');
    assert.deepEqual((await call('GET', `characters?q=${encodeURIComponent('Hoảng')}`)).answer, []);
    await call('DELETE', `books/${record.id}`);
  });
  it('keeps the settings, merged', async () => {
    await call('PATCH', 'settings', { zen: true, sort: { field: 'name' } });
    await call('PATCH', 'settings', { fontSize: 18 });
    assert.deepEqual((await call('GET', 'settings')).answer, { zen: true, sort: { field: 'name' }, fontSize: 18 });
  });
  it('keeps where each book was left, and the names corrected in it', async () => {
    await Promise.all([call('PUT', 'progress/a-1', { offset: 5 }), call('PUT', 'progress/b-2', { offset: 6 })]);
    let { answer } = await call('GET', 'progress');
    assert.equal(answer['a-1'].offset, 5);
    assert.equal(answer['b-2'].offset, 6);
    assert.equal((await call('GET', 'names/a-1')).status, 204);
    await call('PUT', 'names/a-1', 'Lâm = Lam\n');
    assert.deepEqual(await call('GET', 'names/a-1'), { status: 200, answer: 'Lâm = Lam\n' });
  });
  it('turns away what is no book, and an id that is no id', async () => {
    assert.equal((await call('POST', 'books', { name: 'notes.md', size: 1, text: 'x' })).status, 400);
    assert.equal((await call('POST', 'books', { name: '../escape.txt', size: 1, text: 'x' })).status, 400);
    assert.equal((await call('POST', 'books', '{ not json')).status, 415);
    let broken = await fetch(`${base}/api/books`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{ not json' });
    assert.equal(broken.status, 400);
    assert.equal((await call('GET', `names/${encodeURIComponent('../settings')}`)).status, 400);
    assert.equal((await call('GET', 'search?q=x&book=../x')).status, 400);
    assert.equal((await call('GET', 'books/no-such-book')).status, 404);
  });

  // a request with the headers a browser would not let a page set: the name it is asked by, and
  // the origin of the page asking
  let raw = (method: string, route: string, headers: http.OutgoingHttpHeaders, body?: string) => new Promise<{ status?: number; answer: string }>((resolve, reject) => {
    let request = http.request(`${base}${route}`, { method, headers }, (response) => {
      let chunks: Buffer[] = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, answer: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end(body);
  });
  it('answers only what is asked by this computer\'s name', async () => {
    assert.equal((await raw('GET', '/api/progress', { host: 'rebound.example:8080' })).status, 403);
    assert.equal((await raw('GET', '/', { host: 'rebound.example' })).status, 403);
    assert.equal((await raw('GET', '/api/progress', { host: `localhost:${port()}` })).status, 200);
  });
  it('answers the name of a proxy in front of it, and its page served over https', async () => {
    assert.equal((await raw('GET', '/api/progress', { host: 'reader.example' })).status, 200);
    assert.equal((await raw('GET', '/api/progress', { host: 'reader.example:18443' })).status, 200);
    assert.equal((await raw('GET', '/api/progress', { host: 'reader.example.evil' })).status, 403);
    let saved = (origin: string) => raw('PATCH', '/api/settings', { host: 'reader.example', origin, 'content-type': 'application/json' }, '{"proxied":true}');
    assert.equal((await saved('https://reader.example')).status, 204);
    assert.equal((await saved('http://reader.example')).status, 204);
    assert.equal((await saved('https://another.example')).status, 403);
  });
  it('changes nothing for a page of another site', async () => {
    let book = JSON.stringify(upload);
    let asked = (origin: string) => raw('POST', '/api/books', { 'content-type': 'application/json', ...(origin && { origin }) }, book);
    assert.equal((await asked('https://another.example')).status, 403);
    assert.equal((await asked('null')).status, 403);
    assert.equal((await raw('POST', '/api/library/scan', { origin: 'https://another.example' })).status, 403);
    assert.equal((await asked(base)).status, 200);
    // a form of another site can only send text, and a book is sent as JSON
    assert.equal((await raw('POST', '/api/books', { 'content-type': 'text/plain' }, book)).status, 415);
  });
  it('turns away a path badly escaped', async () => {
    assert.equal((await raw('GET', '/api/names/%E0%A4%A', {})).status, 400);
  });
});

describe('a sample of a library', () => {
  it('reads only so many of its books, the same ones each time', async () => {
    let data = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-test-'));
    let shelf = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-shelf-'));
    for(let n = 1; n <= 5; n++) fs.writeFileSync(path.join(shelf, `Sách ${n} (1-3 chương).txt`), bookText('Hoàng Dung'));
    // a scan of the library by a server started again, and the books it then has
    let scanned = async () => {
      let library = createLibrary({ data, libraries: [{ name: 'shelf', dir: shelf }], sample: 2 });
      try {
        library.scan();
        await library.scanned();
        let { books } = await library.books({ every: true, limit: 100 });
        return { scan: library.status().scan, ids: books.map(book => book.id).sort() };
      } finally {
        await library.close();
      }
    };
    try {
      let first = await scanned();
      assert.deepEqual([first.scan.files, first.ids.length], [2, 2]);
      let again = await scanned();
      assert.deepEqual([again.scan.files, again.scan.read, again.scan.removed], [2, 0, 0]);
      assert.deepEqual(again.ids, first.ids);
    } finally {
      fs.rmSync(data, { recursive: true, force: true });
      fs.rmSync(shelf, { recursive: true, force: true });
    }
  });
});

describe('what the reader keeps', () => {
  let made: string[] = [];
  let folder = (name: string) => {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), `hyper-reader-${name}-`));
    made.push(dir);
    return dir;
  };
  after(() => { for(let dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

  it('outlives library.db, which is made again from the files', async () => {
    let data = folder('test');
    let shelf = folder('shelf');
    fs.writeFileSync(path.join(shelf, 'Sách (1-3 chương).txt'), bookText('Hoàng Dung'));
    let open = () => createLibrary({ data, libraries: [{ name: 'shelf', dir: shelf }] });
    let library = open();
    await library.saveProgress('sach-1', { offset: 42 });
    await library.saveSettings({ zen: true });
    await library.saveNames('sach-1', 'Lâm = Lam\n');
    await library.close();
    for(let file of ['library.db', 'library.db-wal', 'library.db-shm']) fs.rmSync(path.join(data, file), { force: true });
    library = open();
    try {
      library.scan();
      await library.scanned();
      assert.equal((await library.books({ every: true })).total, 1);
      assert.deepEqual([(await library.progress())['sach-1'], await library.settings(), await library.names('sach-1')], [{ offset: 42 }, { zen: true }, 'Lâm = Lam\n']);
    } finally {
      await library.close();
    }
  });
  it('is taken out of a library.db that kept it, once', async () => {
    let data = folder('test');
    let old = new DatabaseSync(path.join(data, 'library.db'));
    old.exec(`create table progress (book_id text primary key, record text not null);
      create table settings (key text primary key, value text not null);
      create table names (book_id text primary key, text text not null);
      insert into progress values ('a-1', '{"offset":7}');
      insert into settings values ('fontSize', '18');
      insert into names values ('a-1', 'Lâm = Lam');`);
    old.close();
    let library = createLibrary({ data });
    try {
      assert.deepEqual([(await library.progress())['a-1'], await library.settings(), await library.names('a-1')], [{ offset: 7 }, { fontSize: 18 }, 'Lâm = Lam']);
    } finally {
      await library.close();
    }
    let db = new DatabaseSync(path.join(data, 'library.db'), { readOnly: true });
    let left = db.prepare("select name from sqlite_master where name in ('progress', 'settings', 'names')").all();
    db.close();
    assert.deepEqual(left, []);
  });
});
