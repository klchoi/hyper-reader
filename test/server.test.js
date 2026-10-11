// The server's answers, as the page's server backend asks them: a server on a port of its own,
// keeping its books in a folder made for the test, with a library of its own to scan.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createServer } = require('../server/server.js');
const { loadParser } = require('../lib/parser.js');

const { extractChapters, normalizeFileContent, PARSER_VERSION } = loadParser();

const story = (count, who) => Array.from({ length: count }, (_, k) => (
  `Hôm ấy nàng đi qua núi ${k % 7 ? 'rừng' : 'suối'} và gặp ${who} bên bờ, nhớ chuyện cũ rất lâu trước kia.`
)).join('\n\n');
const bookText = (who) => ['Sách thử tác giả: ai đó', ...[1, 2, 3].map(n => `Chương ${n}: Tiêu đề ${n}\n\n${story(8, who)}`)].join('\n\n');
const upload = { name: 'Sách tải lên (1-3 chương).txt', size: 0, text: bookText('Quách Tĩnh') };
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

describe('the server', () => {
  let server, data, shelf, base;
  // the answer as the page reads it: JSON, text, or the status alone
  let call = async (method, route, body) => {
    let sent = body !== undefined && {
      headers: { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    };
    let response = await fetch(`${base}/api/${route}`, { method, ...sent });
    let type = response.headers.get('content-type') ?? '';
    let answer = type.startsWith('application/json') ? await response.json() : await response.text();
    return { status: response.status, answer };
  };
  let books = async () => (await call('GET', 'books')).answer;
  let bookNamed = async (name) => (await books()).find(book => book.name === name);
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
    server = createServer({ data, libraries: [{ name: 'shelf', dir: shelf }] });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
    server.library.scan();
    await settled();
  });
  after(async () => {
    await new Promise(resolve => server.close(resolve));
    await server.library.close();
    fs.rmSync(data, { recursive: true, force: true });
    fs.rmSync(shelf, { recursive: true, force: true });
  });

  it('serves the page, at any place in it, and says it keeps the books', async () => {
    for(let at of ['/', '/books/sach-thu-1234abcd?at=120']) {
      assert.ok((await (await fetch(`${base}${at}`)).text()).includes('<title>Text Reader</title>'));
    }
    assert.deepEqual((await call('GET', 'hello')).answer, { backend: 'server' });
  });
  it('finds the books of a library, each its own by where it is', async () => {
    let found = await books();
    assert.equal(found.length, 2);
    assert.deepEqual(found.map(book => book.name), ['Sách thử', 'Sách thử']);
    assert.notEqual(found[0].id, found[1].id);
    assert.ok(found.every(book => /^sach-thu-[0-9a-f]{8}$/.test(book.id) && book.library === 'shelf' && !book.deletable));
    let { answer: status } = await call('GET', 'library');
    assert.deepEqual(status.libraries, ['shelf']);
    assert.equal(status.scan.files, 2);
  });
  it('reads a book with the page\'s parser, and cuts a chapter as it does', async () => {
    let { id } = await bookNamed('Sách thử');
    let { answer: record } = await call('GET', `books/${id}`);
    assert.equal(record.parser, PARSER_VERSION);
    assert.deepEqual(record.chapters.map(c => c.title), ['Sách thử', 'Chương 1: Tiêu đề 1', 'Chương 2: Tiêu đề 2', 'Chương 3: Tiêu đề 3']);
    let parsed = extractChapters('Sách thử', normalizeFileContent(bookText('Hoàng Dung')), { name: 'Sách thử' });
    let { answer: chapter } = await call('GET', `books/${id}/chapters/${parsed[2].id}`);
    assert.equal(chapter.content, parsed[2].content);
    assert.equal(chapter.offset, parsed[2].offset);
    assert.equal((await call('GET', `books/${id}/chapters/no-such-chapter`)).status, 404);
  });
  it('keeps a book dropped on the page with the uploads, and deletes only that', async () => {
    let { status, answer: record } = await call('POST', 'books', upload);
    assert.equal(status, 200);
    assert.ok(fs.existsSync(path.join(data, 'uploads', upload.name)));
    let kept = await bookNamed('Sách tải lên');
    assert.equal(kept.id, record.id);
    assert.equal(kept.library, 'uploads');
    assert.ok(kept.deletable);
    let library = (await books()).find(book => book.library === 'shelf');
    assert.equal((await call('DELETE', `books/${library.id}`)).status, 403);
    assert.equal((await call('DELETE', `books/${kept.id}`)).status, 204);
    assert.ok(!fs.existsSync(path.join(data, 'uploads', upload.name)));
    assert.equal((await call('GET', `books/${kept.id}`)).status, 404);
  });
  it('reads a book again when an older parser read it, or its file changed', async () => {
    let file = path.join(shelf, 'Sách thử (1-3 chương).txt');
    let { id } = (await books()).find(book => book.path === 'Sách thử (1-3 chương).txt');
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
  it('finds what came, changed and went in a library when scanned again', async () => {
    let gone = (await books()).find(book => book.library === 'shelf');
    await call('PUT', `progress/${gone.id}`, { offset: 120 });
    fs.rmSync(path.join(shelf, 'nested'), { recursive: true });
    fs.writeFileSync(path.join(shelf, 'Mới (1-3 chương).txt'), bookText('Hoàng Dung'));
    assert.equal((await call('POST', 'library/scan')).status, 200);
    await settled();
    let { scan } = (await call('GET', 'library')).answer;
    assert.equal(scan.files, 2);
    assert.equal(scan.read, 1);
    assert.equal(scan.removed, 1);
    assert.deepEqual((await books()).map(book => book.name).sort(), ['Mới', 'Sách thử']);
    // where a book was left outlives it, for it to come back to
    assert.equal((await call('GET', 'progress')).answer[gone.id].offset, 120);
  });
  it('finds the books a character is in', async () => {
    let [person] = (await call('GET', `characters?q=${encodeURIComponent('hoang dung')}`)).answer;
    assert.equal(person.name, 'Hoàng Dung');
    assert.deepEqual(person.books.map(book => book.name).sort(), ['Mới', 'Sách thử']);
    assert.ok(person.books.every(book => book.mentions === 24));
    assert.deepEqual((await call('GET', 'characters?q=nobody')).answer, []);
  });
  it('finds what is said, in the library and in a book, however it is accented', async () => {
    let { answer: found } = await call('GET', `search?q=${encodeURIComponent('hoang dung')}`);
    assert.deepEqual(found.map(book => [book.name, book.chapters]).sort(), [['Mới', 3], ['Sách thử', 3]]);
    let { id } = await bookNamed('Sách thử');
    let { answer: inBook } = await call('GET', `search?q=${encodeURIComponent('Hoàng dung')}&book=${id}`);
    assert.ok(inBook.indexed);
    assert.equal(inBook.mentions.length, 24);
    let [first] = inBook.mentions;
    assert.equal(first.match, 'Hoàng Dung');
    assert.ok(first.before.endsWith('gặp '));
    let text = normalizeFileContent(bookText('Hoàng Dung'));
    assert.equal(text.slice(first.offset, first.offset + first.match.length), 'Hoàng Dung');
    assert.deepEqual((await call('GET', `search?q=dai+ca&book=${id}`)).answer.mentions, []);
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
  let raw = (method, route, headers, body) => new Promise((resolve, reject) => {
    let request = http.request(`${base}${route}`, { method, headers }, (response) => {
      let chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, answer: Buffer.concat(chunks).toString() }));
    });
    request.on('error', reject);
    request.end(body);
  });
  it('answers only what is asked by this computer\'s name', async () => {
    assert.equal((await raw('GET', '/api/progress', { host: 'rebound.example:8080' })).status, 403);
    assert.equal((await raw('GET', '/', { host: 'rebound.example' })).status, 403);
    assert.equal((await raw('GET', '/api/progress', { host: `localhost:${server.address().port}` })).status, 200);
  });
  it('changes nothing for a page of another site', async () => {
    let book = JSON.stringify(upload);
    let asked = (origin) => raw('POST', '/api/books', { 'content-type': 'application/json', ...(origin && { origin }) }, book);
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
