#!/usr/bin/env node
// The page's other backend (see backends.ts in src/). It serves the page as built
// (hyper-reader.html), and keeps the books in a SQLite database in a folder of its own (see
// store.ts): those of the libraries it is given, folders of .txt files read where they are, and
// those dropped on the page, kept in <data>/uploads. The books are read by the page's own parser
// (src/parser.ts), in processes of their own (readers.ts), and their full text indexed for search
// behind them (indexer.ts); the processes end when they have nothing left to do:
//
//   node server/server.ts [--port 8080] [--host 127.0.0.1] [--data <folder>] [--library [name=]<folder>]...
//                         [--allow-host <name>]...
//
// A library is known by its name (the folder's own name if none is given), so a book keeps its
// id, and where it was left, wherever the folder is mounted. The libraries are scanned when the
// server starts, and again when asked (POST /api/library/scan).
//
// It answers on this computer only (127.0.0.1): it has no logins, and what it keeps is a private
// library. So it answers only what is asked of it by this computer's name, and changes nothing
// for a page of another site (see `foreign`). In a container it listens on every address of the
// container (`--host 0.0.0.0`), and the port is published to this computer only (compose.yaml).
// Behind a proxy that asks who is asking (a login), it answers the name the proxy is reached by
// too (`--allow-host reader.example.com`), its page served over https or not.
import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLibrary } from './library.ts';
import type { Library, LibraryDir } from './library.ts';

// the page, as built
const PAGE = path.join(import.meta.dirname, '..', 'hyper-reader.html');

// a book's id, a chapter's: nothing that could walk out of a folder
const ID = /^[\w-]+$/;

// What a page of another site could make a browser here ask, and is turned away:
// - a name of its own pointed at 127.0.0.1 (DNS rebinding) makes its page this server's, by
//   that name: only this computer's names for the server are answered, and those it is given
//   (`allowed`, the names of a proxy in front of it)
// - a form or a script of its page can send a change: one sent from another origin is refused,
//   and a body that is JSON must say so, which a browser will not send across sites unasked.
//   Its own page may be served over https, by a proxy
const LOCAL_HOST = /^(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/;
function foreign(request: IncomingMessage, allowed: string[]) {
  let host = request.headers.host ?? '';
  if(!LOCAL_HOST.test(host) && !allowed.includes(host.replace(/:\d+$/, '').toLowerCase())) return 'not asked by this computer\'s name';
  let origin = request.headers.origin;
  if(request.method !== 'GET' && origin != null && origin !== `http://${host}` && origin !== `https://${host}`) return 'not asked by this page';
  return null;
}

// what the page's server backend asks, by method and path; the body each takes is JSON (as sent,
// which is the asker's to get right), or text
type Answer = (params: string[], body: any, query: URLSearchParams) => unknown;
type Route = [method: string, pattern: RegExp, answer: Answer, kind?: 'json' | 'text'];
function routes(library: Library): Route[] {
  return [
    ['GET', /^\/api\/hello$/, () => ({ backend: 'server' })],
    ['GET', /^\/api\/settings$/, () => library.settings()],
    ['PATCH', /^\/api\/settings$/, (_, body) => library.saveSettings(body)],
    ['GET', /^\/api\/progress$/, () => library.progress()],
    ['PUT', /^\/api\/progress\/([^/]+)$/, ([id], body) => library.saveProgress(id, body)],
    // a book with no names corrected yet has nothing to send, which is no error
    ['GET', /^\/api\/names\/([^/]+)$/, ([id]) => library.names(id), 'text'],
    ['PUT', /^\/api\/names\/([^/]+)$/, ([id], body) => library.saveNames(id, body), 'text'],
    ['GET', /^\/api\/books$/, () => library.books()],
    ['POST', /^\/api\/books$/, (_, body) => library.addBook(body ?? {})],
    ['GET', /^\/api\/books\/([^/]+)$/, ([id]) => library.book(id)],
    ['GET', /^\/api\/books\/([^/]+)\/chapters\/([^/]+)$/, ([id, chapterId]) => library.chapter(id, chapterId)],
    ['POST', /^\/api\/books\/([^/]+)\/reread$/, ([id]) => library.rereadBook(id)],
    ['DELETE', /^\/api\/books\/([^/]+)$/, ([id]) => library.deleteBook(id)],
    ['GET', /^\/api\/library$/, () => library.status()],
    ['POST', /^\/api\/library\/scan$/, () => library.scan()],
    // ?q= what is said; &book= in one book, every place it is said
    ['GET', /^\/api\/search$/, (_, __, query) => {
      let book = query.get('book');
      if(book != null && !ID.test(book)) throw Object.assign(new Error('not an id'), { status: 400 });
      return library.search(query.get('q') ?? '', book);
    }],
    ['GET', /^\/api\/characters$/, (_, __, query) => library.characters(query.get('q') ?? '')],
  ];
}

const LIMIT = 200 * 1024 * 1024;   // the longest body taken: a book of a few hundred MB is no book

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let chunks: Buffer[] = [];
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

export function createServer({ data, libraries = [], allowedHosts = [] }: { data: string; libraries?: LibraryDir[]; allowedHosts?: string[] }) {
  let allowed = allowedHosts.map(name => name.toLowerCase());
  let library = createLibrary({ data, libraries });
  let table = routes(library);
  let server = http.createServer(async (request, response) => {
    let send = (status: number, body?: string, type?: string) => {
      response.writeHead(status, body == null ? {} : { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
      response.end(body);
    };
    try {
      let refused = foreign(request, allowed);
      if(refused) return send(403, refused, 'text/plain');
      let { pathname, searchParams } = new URL(request.url ?? '/', 'http://localhost');
      if(pathname.startsWith('/api/')) {
        for(let [method, pattern, answer, kind = 'json'] of table) {
          let found = pattern.exec(pathname);
          if(!found || request.method !== method) continue;
          let params = found.slice(1).map(decodeURIComponent);
          if(params.some(param => !ID.test(param))) return send(400, 'not an id', 'text/plain');
          let body: unknown;
          if(['POST', 'PUT', 'PATCH'].includes(method)) {
            body = await readBody(request);
            if(kind === 'json' && body !== '') {
              if(!request.headers['content-type']?.startsWith('application/json')) return send(415, 'JSON is sent as application/json', 'text/plain');
              try { body = JSON.parse(body as string); }
              catch { return send(400, 'not JSON', 'text/plain'); }
            }
          }
          let result = await answer(params, body, searchParams);
          if(result === undefined) return send(204);
          if(result === null) return send(404, 'not found', 'text/plain');
          return kind === 'text' ? send(200, String(result), 'text/plain') : send(200, JSON.stringify(result), 'application/json');
        }
        return send(404, 'not found', 'text/plain');
      }
      // any other path is a place in the page (`/books/<id>`), which finds it itself
      if(request.method === 'GET') return send(200, await fs.readFile(PAGE, 'utf8'), 'text/html');
      send(404, 'not found', 'text/plain');
    } catch(error) {
      // a path badly escaped is the asker's fault; anything else not foreseen is ours (a file of
      // ours that is not JSON too), and what went wrong (a path on this disk) stays here
      let status = (error as { status?: number }).status ?? (error instanceof URIError ? 400 : 500);
      if(status === 500) console.error(request.method, request.url, error);
      send(status, status === 500 ? 'server error' : String((error as Error).message), 'text/plain');
    }
  });
  server.on('close', () => library.close());
  return Object.assign(server, { library });
}

// `--library mega=/books` is a library named mega; `--library /books`, one named books
function librariesOf(args: string[]) {
  let libraries: LibraryDir[] = [];
  args.forEach((arg, at) => {
    if(arg !== '--library') return;
    let given = /^(?:([\w-]+)=)?(.+)$/.exec(args[at + 1] ?? '');
    if(!given) throw new Error('--library takes a folder: --library [name=]<folder>');
    let [, name, dir] = given;
    libraries.push({ name: name ?? path.basename(path.resolve(dir)), dir: path.resolve(dir) });
  });
  return libraries;
}

if(import.meta.main) {
  // `--port 8080` or `--port=8080`
  let args = process.argv.slice(2).flatMap(arg => /^--[\w-]+=/.test(arg) ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg]);
  let option = (name: string, fallback: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
  let port = Number(option('--port', '8080'));
  let host = option('--host', '127.0.0.1');
  let data = path.resolve(option('--data', path.join(import.meta.dirname, '..', 'data')));
  let libraries = librariesOf(args);
  let allowedHosts = args.flatMap((arg, at) => {
    if(arg !== '--allow-host') return [];
    if(!args[at + 1]) throw new Error('--allow-host takes a name: --allow-host reader.example.com');
    return [args[at + 1]];
  });
  let server = createServer({ data, libraries, allowedHosts });
  server.listen(port, host, () => {
    console.log(`hyper-reader on http://${host}:${port}/, keeping books in ${data}`);
    for(let { name, dir } of libraries) console.log(`library ${name}: ${dir}`);
    for(let name of allowedHosts) console.log(`answering ${name} too`);
    // what came, changed or went while the server was not running
    server.library.scan();
    server.library.scanned().then(() => {
      let { scan } = server.library.status();
      console.log(`scanned: ${scan.files} files, ${scan.read} read, ${scan.removed} gone${scan.failed ? `, ${scan.failed} not read` : ''}`);
    });
  });
  // stopped (docker stop, ctrl-c): closed as well as it can be in a few seconds, and gone (a scan
  // going on is taken up again by the next start). In a container the server may be process 1,
  // which a signal no one listens for does not stop
  let stop = () => {
    setTimeout(() => process.exit(0), 3000).unref();
    server.close();
    server.closeAllConnections();
    server.library.close().then(() => process.exit(0));
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}
