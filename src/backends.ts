// What keeps the books, where each was left and the settings, and reads a book into its
// chapters. The page asks it, and does not mind which it is. Every call is async:
//   settings()                  every setting, as { key: value }
//   saveSettings(settings)      some of them
//   progress()                  where each book was left, as { bookId: record }
//   saveProgress(id, record)
//   names(id)                   the names corrected in a book, as text (or undefined)
//   saveNames(id, text)
//   books()                     the books kept: [{ id, name, description, size, deletable }]
//   addBooks(files)             read and keep [{ name, size, text }]; their records
//   book(id)                    the record of a book (bookRecord), read again first if an
//                               older parser read it; null for a book not kept
//   chapter(id, listed)         a chapter of the record, with its text; null if it is gone
//   rereadBook(id)              read a kept book again; its record, or null
//   deleteBook(id)
//
// Served by the server (`node server/server.js`), the page leaves its books to the server;
// opened as a file, or served by anything else, it keeps them in the browser. The two keep
// books apart: a book dropped on one is not in the other.
import { openDB } from 'idb';
import type { Chapter, Listed } from './places.ts';

export type FileInfo = { name: string; size: number };
// a book as the library lists it. `library` and `path` say where it is, for a book of a library
// the server reads where it is, which is not deleted from the page
export type BookSummary = { id: string; name: string; description?: string; size: number; library?: string; path?: string; deletable: boolean };
export type BookRecord = { id: string; name: string; description?: string; parser: number; chapters: Listed[] };
export type Progress = { offset?: number; chapterId?: string; chapterIndex?: number; chapterCount?: number; updatedAt?: string };

export interface Backend {
  settings(): Promise<Record<string, any>>;
  saveSettings(settings: Record<string, any>): Promise<void>;
  progress(): Promise<Record<string, Progress>>;
  saveProgress(id: string, record: Progress): Promise<unknown>;
  names(id: string): Promise<string | undefined>;
  saveNames(id: string, text: string): Promise<unknown>;
  books(): Promise<BookSummary[]>;
  addBooks(files: (FileInfo & { text: string })[]): Promise<BookRecord[]>;
  book(id: string): Promise<BookRecord | null>;
  chapter(id: string, listed: Listed): Promise<Chapter | null>;
  rereadBook(id: string): Promise<BookRecord | null>;
  deleteBook(id: string): Promise<void>;
}

// what the browser's backend needs of the page: the reader of books, and what is kept of one
export type Reading = {
  readBook(file: FileInfo, text: string): Promise<{ id: string; chapters: Chapter[] }>;
  Book(file: { name: string }): { id: string; name: string; description?: string };
  bookRecord(book: { id: string; chapters: Chapter[] }): BookRecord;
  PARSER_VERSION: number;
};

export async function chooseBackend(reading: Reading): Promise<Backend> {
  if (location.protocol.startsWith('http')) {
    try {
      let hello = await fetch('api/hello');
      if (hello.ok && (await hello.json()).backend === 'server') {
        console.info('Books kept by the server');
        return serverBackend();
      }
    } catch (error) {
      console.info('No server to keep the books, the browser keeps them:', error);
    }
  }
  return browserBackend(reading);
}

// the server's: it reads the books and keeps them (see server/server.js for its answers)
function serverBackend(): Backend {
  // a body is sent as JSON, or as text when it is text; an answer of 404 is null
  let call = async (method: string, route: string, body?: unknown) => {
    let text = typeof body === 'string';
    let sent = body !== undefined && {
      headers: { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' },
      body: text ? (body as string) : JSON.stringify(body),
    };
    let response = await fetch(`api/${route}`, { method, ...sent });
    // the answer is read whole, whatever it is: one left unread holds its connection, and
    // the next call over it is cut off
    let answer = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} api/${route}: ${response.status} ${answer}`);
    return response.status === 204 ? undefined : answer;
  };
  let id = encodeURIComponent;
  return {
    settings: () => call('GET', 'settings'),
    saveSettings: (settings) => call('PATCH', 'settings', settings),
    progress: () => call('GET', 'progress'),
    saveProgress: (bookId, record) => call('PUT', `progress/${id(bookId)}`, record),
    names: (bookId) => call('GET', `names/${id(bookId)}`),
    saveNames: (bookId, text) => call('PUT', `names/${id(bookId)}`, text),
    books: () => call('GET', 'books'),
    addBooks: (files) => Promise.all(files.map(file => call('POST', 'books', file))),
    book: (bookId) => call('GET', `books/${id(bookId)}`),
    chapter: (bookId, listed) => call('GET', `books/${id(bookId)}/chapters/${id(listed.id)}`),
    rereadBook: (bookId) => call('POST', `books/${id(bookId)}/reread`),
    deleteBook: (bookId) => call('DELETE', `books/${id(bookId)}`),
  };
}

// the browser's: IndexedDB, and the parser in a worker (see reading.js)
async function browserBackend({ readBook, Book, bookRecord, PARSER_VERSION }: Reading): Promise<Backend> {
  let db = await openDB('text-reader', 23, {
    upgrade(db, oldVersion, newVersion, transaction, events) {
      console.log('upgrade db', { oldVersion, newVersion, transaction, events });
      let stores = ['files', 'fileContents', 'settings', 'progress', 'books', 'chapters', 'names'];
      for (let store of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    },
    blocked: console.log,
    blocking: console.log,
    terminated: console.log,
  });
  // a store as { key: value }
  let everything = async (store: string) => {
    let found: Record<string, any> = {};
    for (let cursor = await db.transaction(store).store.openCursor(); cursor; cursor = await cursor.continue()) {
      found[cursor.key as string] = cursor.value;
    }
    return found;
  };
  let backend: Backend = {
    settings: () => everything('settings'),
    async saveSettings(settings) {
      let tx = db.transaction('settings', 'readwrite');
      await Promise.all([...Object.entries(settings).map(([key, value]) => tx.store.put(value, key)), tx.done]);
    },
    progress: () => everything('progress'),
    saveProgress: (id, record) => db.put('progress', record, id),
    names: (id) => db.get('names', id),
    saveNames: (id, text) => db.put('names', text, id),
    // the books as the files they came from, which say what each is
    books: async () => ((await db.getAll('files')) as FileInfo[]).map(file => ({ ...Book(file), size: file.size, deletable: true })),
    async addBooks(files) {
      let chapterKeys = (await db.getAllKeys('chapters')) as string[];
      // the books are read before the transaction opens: it would not wait for them
      let read = await Promise.all(files.map(async ({ name, size, text }) => ({ file: { name, size }, text, book: await readBook({ name, size }, text) })));
      let tx = db.transaction(['files', 'fileContents', 'books', 'chapters'], 'readwrite');
      await Promise.all([
        ...read.flatMap(({ file, text, book }) => [
          tx.objectStore('files').put(file, book.id),
          tx.objectStore('fileContents').put(text, book.id),
          tx.objectStore('books').put(bookRecord(book), book.id),
          ...chapterKeys.filter(k => k.startsWith(`${book.id}/`)).map(k => tx.objectStore('chapters').delete(k)),
          ...book.chapters.map(c => tx.objectStore('chapters').put(c, `${book.id}/${c.id}`)),
        ]),
        tx.done,
      ]);
      return read.map(({ book }) => bookRecord(book));
    },
    async book(id) {
      let book = await db.get('books', id);
      // a book stored by an older parser keeps the titles and groups that parser cut it
      // into, and one stored before chapters carried their offset has none: reading the
      // file again is what updates them
      let stale = !book || book.parser !== PARSER_VERSION || !book.chapters.some((c: Listed) => c.offset != null);
      if (!stale) return book;
      console.info('Book read again:', { id, parser: book?.parser });
      return backend.rereadBook(id);
    },
    async chapter(id, listed) {
      let chapter = await db.get('chapters', `${id}/${listed.id}`);
      // the book record is the one that places the chapter, so it holds the offset
      return chapter && { ...chapter, offset: listed.offset };
    },
    async rereadBook(id) {
      let [file, text] = await Promise.all([db.get('files', id), db.get('fileContents', id)]);
      if (!file || !text) {
        console.info('File not found:', { id });
        return null;
      }
      let [book] = await backend.addBooks([{ ...file, text }]);
      return book;
    },
    async deleteBook(id) {
      let chapterKeys = ((await db.getAllKeys('chapters')) as string[]).filter(k => k.startsWith(`${id}/`));
      let tx = db.transaction(['files', 'fileContents', 'books', 'chapters'], 'readwrite');
      await Promise.all([
        tx.objectStore('files').delete(id),
        tx.objectStore('fileContents').delete(id),
        tx.objectStore('books').delete(id),
        ...chapterKeys.map(k => tx.objectStore('chapters').delete(k)),
        tx.done,
      ]);
    },
  };
  return backend;
}
