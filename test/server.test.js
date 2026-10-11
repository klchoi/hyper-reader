// The server's answers, as the page's server backend asks them: a server on a port of its own,
// keeping its books in a folder made for the test.
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createServer } = require('../server/server.js');
const { loadParser } = require('../lib/parser.js');

const { extractChapters, normalizeFileContent, PARSER_VERSION } = loadParser();

const story = (count) => Array.from({ length: count }, (_, k) => `Nàng đi qua núi ${k % 7 ? 'rừng' : 'suối'} và nhớ chuyện cũ rất lâu trước kia.`).join('\n\n');
const text = ['Sách thử tác giả: ai đó', ...[1, 2, 3].map(n => `Chương ${n}: Tiêu đề ${n}\n\n${story(8)}`)].join('\n\n');
const file = { name: 'Sách thử (1-3 chương).txt', size: text.length, text };

describe('the server', () => {
  let server;
  let data;
  let base;
  // the answer as the page reads it: JSON, text, or the status alone
  let call = async (method, route, body) => {
    let response = await fetch(`${base}/api/${route}`, {
      method,
      headers: typeof body === 'string' ? { 'content-type': 'text/plain' } : { 'content-type': 'application/json' },
      body: body === undefined || typeof body === 'string' ? body : JSON.stringify(body),
    });
    let type = response.headers.get('content-type') ?? '';
    let answer = type.startsWith('application/json') ? await response.json() : await response.text();
    return { status: response.status, answer };
  };

  before(async () => {
    data = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-test-'));
    server = createServer({ data });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => {
    server.close();
    fs.rmSync(data, { recursive: true, force: true });
  });

  it('serves the page, and says it keeps the books', async () => {
    let page = await fetch(`${base}/`);
    assert.match(await page.text(), /<script id="chapter-parser">/);
    assert.deepEqual((await call('GET', 'hello')).answer, { backend: 'server', parser: PARSER_VERSION });
  });
  it('reads a book with the page\'s parser, and keeps it', async () => {
    let { status, answer: record } = await call('POST', 'books', file);
    assert.equal(status, 200);
    assert.equal(record.id, 'sach-thu');
    assert.equal(record.parser, PARSER_VERSION);
    assert.deepEqual(record.chapters.map(c => c.title), ['Sách thử', 'Chương 1: Tiêu đề 1', 'Chương 2: Tiêu đề 2', 'Chương 3: Tiêu đề 3']);
    assert.ok(record.chapters.every(c => !('content' in c)));
    assert.deepEqual((await call('GET', 'files')).answer, [{ name: file.name, size: file.size }]);
    assert.deepEqual((await call('GET', 'books/sach-thu')).answer, record);
  });
  it('cuts a chapter\'s text as the parser does', async () => {
    let parsed = extractChapters('Sách thử', normalizeFileContent(text), { name: 'Sách thử' });
    let { answer: chapter } = await call('GET', `books/sach-thu/chapters/${encodeURIComponent(parsed[2].id)}`);
    assert.equal(chapter.content, parsed[2].content);
    assert.equal(chapter.offset, parsed[2].offset);
    assert.equal((await call('GET', 'books/sach-thu/chapters/no-such-chapter')).status, 404);
  });
  it('reads a book again when an older parser read it', async () => {
    let kept = path.join(data, 'books', 'sach-thu.json');
    let record = JSON.parse(fs.readFileSync(kept, 'utf8'));
    fs.writeFileSync(kept, JSON.stringify({ ...record, parser: 1, chapters: [] }));
    let { answer } = await call('GET', 'books/sach-thu');
    assert.equal(answer.parser, PARSER_VERSION);
    assert.equal(answer.chapters.length, 4);
    assert.equal((await call('POST', 'books/sach-thu/reread')).answer.chapters.length, 4);
  });
  it('keeps the settings, merged', async () => {
    assert.deepEqual((await call('GET', 'settings')).answer, {});
    assert.equal((await call('PATCH', 'settings', { zen: true, sort: { field: 'name' } })).status, 204);
    await call('PATCH', 'settings', { fontSize: 18 });
    assert.deepEqual((await call('GET', 'settings')).answer, { zen: true, sort: { field: 'name' }, fontSize: 18 });
  });
  it('keeps where each book was left', async () => {
    await Promise.all([
      call('PUT', 'progress/sach-thu', { offset: 120, chapterId: 'chuong-1-1' }),
      call('PUT', 'progress/khac', { offset: 5 }),
    ]);
    assert.deepEqual((await call('GET', 'progress')).answer, { 'sach-thu': { offset: 120, chapterId: 'chuong-1-1' }, khac: { offset: 5 } });
  });
  it('keeps the names corrected in a book', async () => {
    assert.equal((await call('GET', 'names/sach-thu')).status, 204);
    await call('PUT', 'names/sach-thu', 'Lâm = Lam\n');
    assert.deepEqual(await call('GET', 'names/sach-thu'), { status: 200, answer: 'Lâm = Lam\n' });
  });
  it('turns away what is no book, and an id that is no id', async () => {
    assert.equal((await call('POST', 'books', { name: 'notes.md', size: 1, text: 'x' })).status, 400);
    assert.equal((await call('POST', 'books', '{ not json')).status, 400);
    assert.equal((await call('GET', `names/${encodeURIComponent('../settings')}`)).status, 400);
    assert.equal((await call('GET', 'books/no-such-book')).status, 404);
  });
  it('deletes a book', async () => {
    assert.equal((await call('DELETE', 'books/sach-thu')).status, 204);
    assert.deepEqual((await call('GET', 'files')).answer, []);
    assert.equal((await call('GET', 'books/sach-thu')).status, 404);
    assert.deepEqual(fs.readdirSync(path.join(data, 'books')), []);
  });
});
