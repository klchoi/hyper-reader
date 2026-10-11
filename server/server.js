#!/usr/bin/env node
// The page's other backend (see Backends in hyper-reader.html). It serves the page, reads books
// with the page's own parser, and keeps them, where each was left, the settings and the names
// as files in a folder of its own:
//
//   node server/server.js [--port 8080] [--data <folder>]
//
//   <data>/library.json       the books kept, as the files they came from: { id: { name, size } }
//   <data>/books/<id>.txt     a book's text, as it came: what it is read again from
//   <data>/books/<id>.read    the text as the parser read it, which the offsets count in
//   <data>/books/<id>.json    what the parser made of it: the book's record (bookRecord)
//   <data>/progress.json      where each book was left: { id: record }
//   <data>/settings.json      { key: value }
//   <data>/names/<id>.txt     the names corrected in a book
//
// A chapter's text is not kept apart: it is cut from the text as read, at the offsets the
// record gives. It answers on this computer only (127.0.0.1): it has no logins, and what it keeps
// is a private library. So it answers only what is asked of it by this computer's name, and
// changes nothing for a page of another site (see `foreign`).
const http = require('node:http');
const fs = require('node:fs/promises');
const { statSync } = require('node:fs');
const path = require('node:path');
const { loadParser, PAGE } = require('../lib/parser.js');

// the parser as the page has it now: loaded again when the page changes
let loaded = { at: 0, parser: null };
function parser() {
  let at = statSync(PAGE).mtimeMs;
  if(at !== loaded.at) loaded = { at, parser: loadParser() };
  return loaded.parser;
}

// a book's id is a slug (see `slug` in the page): nothing that could walk out of the folder
const ID = /^[\w-]+$/;

function createLibrary(data) {
  let file = (...parts) => path.join(data, ...parts);
  let readJSON = async (name, fallback) => {
    try { return JSON.parse(await fs.readFile(file(name), 'utf8')); }
    catch(error) { if(error.code === 'ENOENT') return fallback; throw error; }
  };
  // written whole or not at all: a file half written is never read
  let writes = 0;
  let writeFile = async (name, content) => {
    await fs.mkdir(path.dirname(file(name)), { recursive: true });
    let temporary = `${file(name)}.${process.pid}-${++writes}.tmp`;
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, file(name));
  };
  // a file read, changed and written back by one change at a time
  let queues = new Map();
  let update = (name, change) => {
    let done = (queues.get(name) ?? Promise.resolve()).then(async () => {
      await writeFile(name, JSON.stringify(await change(await readJSON(name, {})), null, 1));
    });
    queues.set(name, done.catch(() => {}));
    return done;
  };

  // the text a book's offsets count in, kept in memory for the books read last
  let texts = new Map();
  let readText = async (id) => {
    if(!texts.has(id)) {
      texts.set(id, await fs.readFile(file('books', `${id}.read`), 'utf8'));
      if(texts.size > 4) texts.delete(texts.keys().next().value);
    }
    return texts.get(id);
  };

  let library = {
    settings: () => readJSON('settings.json', {}),
    saveSettings: (settings) => update('settings.json', (all) => ({ ...all, ...settings })),
    progress: () => readJSON('progress.json', {}),
    saveProgress: (id, record) => update('progress.json', (all) => ({ ...all, [id]: record })),
    async names(id) {
      try { return await fs.readFile(file('names', `${id}.txt`), 'utf8'); }
      catch(error) { if(error.code === 'ENOENT') return undefined; throw error; }
    },
    saveNames: (id, text) => writeFile(path.join('names', `${id}.txt`), text),
    files: async () => Object.values(await readJSON('library.json', {})),
    async addBook({ name, size, text }) {
      let read = parser();
      let book = /\.txt$/i.test(name ?? '') && typeof text === 'string' ? read.Book({ name }) : {};
      if(!book.id || !ID.test(book.id)) throw Object.assign(new Error(`not a book: ${name}`), { status: 400 });
      let normalized = read.normalizeFileContent(text);
      book.chapters = read.extractChapters(book.name, normalized, { name: book.name });
      let record = read.bookRecord(book);
      texts.delete(book.id);
      await writeFile(path.join('books', `${book.id}.txt`), text);
      await writeFile(path.join('books', `${book.id}.read`), normalized);
      await writeFile(path.join('books', `${book.id}.json`), JSON.stringify(record));
      await update('library.json', (all) => ({ ...all, [book.id]: { name, size } }));
      return record;
    },
    async book(id) {
      let record = await readJSON(path.join('books', `${id}.json`), null);
      // a book read by an older parser is read again, as the browser's backend does
      let stale = !record || record.parser !== parser().PARSER_VERSION || !record.chapters.some(c => c.offset != null);
      return stale ? library.rereadBook(id) : record;
    },
    async chapter(id, chapterId) {
      let record = await library.book(id);
      let at = record?.chapters.findIndex(c => c.id === chapterId) ?? -1;
      if(at < 0) return null;
      let text = await readText(id);
      let listed = record.chapters[at];
      let end = record.chapters[at + 1]?.offset ?? text.length;
      return { ...listed, content: text.slice(listed.offset, end).trim() };
    },
    async rereadBook(id) {
      let kept = (await readJSON('library.json', {}))[id];
      if(!kept) return null;
      let text;
      try { text = await fs.readFile(file('books', `${id}.txt`), 'utf8'); }
      catch(error) { if(error.code === 'ENOENT') return null; throw error; }
      return library.addBook({ ...kept, text });
    },
    async deleteBook(id) {
      texts.delete(id);
      await update('library.json', (all) => {
        delete all[id];
        return all;
      });
      await Promise.all(['.txt', '.read', '.json'].map(end => fs.rm(file('books', `${id}${end}`), { force: true })));
    },
  };
  return library;
}

// What a page of another site could make a browser here ask, and is turned away:
// - a name of its own pointed at 127.0.0.1 (DNS rebinding) makes its page this server's, by
//   that name: only this computer's names for the server are answered
// - a form or a script of its page can send a change: one sent from another origin is refused,
//   and a body that is JSON must say so, which a browser will not send across sites unasked
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;
function foreign(request) {
  let host = request.headers.host ?? '';
  if(!LOCAL_HOST.test(host)) return 'not asked by this computer\'s name';
  let origin = request.headers.origin;
  if(request.method !== 'GET' && origin != null && origin !== `http://${host}`) return 'not asked by this page';
  return null;
}

// what the page's server backend asks, by method and path; the body each takes is JSON, or text
function routes(library) {
  return [
    ['GET', /^\/api\/hello$/, () => ({ backend: 'server', parser: parser().PARSER_VERSION })],
    ['GET', /^\/api\/settings$/, () => library.settings()],
    ['PATCH', /^\/api\/settings$/, (_, body) => library.saveSettings(body)],
    ['GET', /^\/api\/progress$/, () => library.progress()],
    ['PUT', /^\/api\/progress\/([^/]+)$/, ([id], body) => library.saveProgress(id, body)],
    // a book with no names corrected yet has nothing to send, which is no error
    ['GET', /^\/api\/names\/([^/]+)$/, ([id]) => library.names(id), 'text'],
    ['PUT', /^\/api\/names\/([^/]+)$/, ([id], body) => library.saveNames(id, body), 'text'],
    ['GET', /^\/api\/files$/, () => library.files()],
    ['POST', /^\/api\/books$/, (_, body) => library.addBook(body)],
    ['GET', /^\/api\/books\/([^/]+)$/, ([id]) => library.book(id)],
    ['GET', /^\/api\/books\/([^/]+)\/chapters\/([^/]+)$/, ([id, chapterId]) => library.chapter(id, chapterId)],
    ['POST', /^\/api\/books\/([^/]+)\/reread$/, ([id]) => library.rereadBook(id)],
    ['DELETE', /^\/api\/books\/([^/]+)$/, ([id]) => library.deleteBook(id)],
  ];
}

const LIMIT = 200 * 1024 * 1024;   // the longest body taken: a book of a few hundred MB is no book

function readBody(request) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let length = 0;
    request.on('data', chunk => {
      length += chunk.length;
      if(length > LIMIT) {
        reject(Object.assign(new Error('too long'), { status: 413 }));
        request.destroy();
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function createServer({ data }) {
  let library = createLibrary(data);
  let table = routes(library);
  return http.createServer(async (request, response) => {
    let send = (status, body, type) => {
      response.writeHead(status, body == null ? {} : { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(body);
    };
    try {
      let refused = foreign(request);
      if(refused) return send(403, refused, 'text/plain');
      let { pathname } = new URL(request.url, 'http://localhost');
      if(request.method === 'GET' && (pathname === '/' || pathname === '/hyper-reader.html')) {
        return send(200, await fs.readFile(PAGE, 'utf8'), 'text/html');
      }
      for(let [method, pattern, answer, kind = 'json'] of table) {
        let found = pattern.exec(pathname);
        if(!found || request.method !== method) continue;
        let params = found.slice(1).map(decodeURIComponent);
        if(params.some(param => !ID.test(param))) return send(400, 'not an id', 'text/plain');
        let body;
        if(['POST', 'PUT', 'PATCH'].includes(method)) {
          body = await readBody(request);
          if(kind === 'json' && body !== '') {
            if(!request.headers['content-type']?.startsWith('application/json')) return send(415, 'JSON is sent as application/json', 'text/plain');
            try { body = JSON.parse(body); }
            catch { return send(400, 'not JSON', 'text/plain'); }
          }
        }
        let result = await answer(params, body);
        if(result === undefined) return send(204);
        if(result === null) return send(404, 'not found', 'text/plain');
        return kind === 'text' ? send(200, result, 'text/plain') : send(200, JSON.stringify(result), 'application/json');
      }
      send(404, 'not found', 'text/plain');
    } catch(error) {
      // a path badly escaped is the asker's fault; anything else not foreseen is ours (a file of
      // ours that is not JSON too), and what went wrong (a path on this disk) stays here
      let status = error.status ?? (error instanceof URIError ? 400 : 500);
      if(status === 500) console.error(request.method, request.url, error);
      send(status, status === 500 ? 'server error' : String(error.message), 'text/plain');
    }
  });
}

module.exports = { createServer, createLibrary };

if(require.main === module) {
  let args = process.argv.slice(2);
  let option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  let port = Number(option('--port', 8080));
  let data = path.resolve(option('--data', path.join(__dirname, '..', 'data')));
  createServer({ data }).listen(port, '127.0.0.1', () => {
    console.log(`hyper-reader on http://127.0.0.1:${port}/, keeping books in ${data}`);
  });
}
