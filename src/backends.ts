// What keeps the books, where each was left and the settings, and reads a book into its
// chapters: the server (`node server/server.ts`, see there for its answers), which serves the page
// too. Every call is async:
//   settings()                  every setting, as { key: value }
//   saveSettings(settings)      some of them
//   progress()                  where each book was left, as { bookId: record }
//   saveProgress(id, record)
//   names(id)                   the names corrected in a book, as text (or undefined)
//   saveNames(id, text)
//   books(query)                the books asked for, a page of them: { total, offset, books }
//                               (see catalog.ts for what can be asked, and what a book shows)
//   tags(limit)                 the tags most books have: [{ tag, count }]
//   addBooks(files)             read and keep [{ name, size, date, text }]; their records
//   book(id)                    the record of a book (see book.ts), read again first if an
//                               older parser read it; null for a book not kept
//   chapter(id, listed, raw)    a chapter of the record as the page shows it: its lines, corrected
//                               by the book's names, and the names in them (see marks.ts); `raw`,
//                               with its text as read too; null if it is gone
//   rereadBook(id)              read a kept book again; its record, or null
//   deleteBook(id)
// and of the libraries on its disk, and the index of the books' text:
//   status()                    the libraries, the scan going or last, and how much is indexed
//   scan()                      a scan of the libraries, if none is going; the status
//   search(q, id?)              the books that say `q`; in book `id`, every place it says it
//   characters(q)               the characters named `q`, with the books they are in
// and the paragraphs bookmarked in the books:
//   bookmarks(id)               a book's, in the order of its text
//   findBookmarks(q, from, n)   every book's that say `q`, the newest first: { total, offset, bookmarks }
//   addBookmark(id, offset)     the paragraph at `offset` bookmarked; the bookmark (the one it had,
//                               if it had one), or null for a book not kept
//   saveBookmarkNote(n, note)
//   deleteBookmark(n)
import type { BookRecord } from './book.ts';
import type { Listed } from './parser.ts';
import { queryString } from './catalog.ts';
import type { Listing, Progress, Query, TagCount } from './catalog.ts';
import type { Marked } from './marks.ts';

// a chapter as the page shows it: `length` is that of its text as read
export type Shown = Listed & Marked & { length: number; content?: string };

// a file dropped on the page: `date` its time (ms)
export type FileInfo = { name: string; size: number; date?: number };
export type { BookRecord, Progress };

export interface Backend {
  settings(): Promise<Record<string, any>>;
  saveSettings(settings: Record<string, any>): Promise<void>;
  progress(): Promise<Record<string, Progress>>;
  saveProgress(id: string, record: Progress): Promise<unknown>;
  names(id: string): Promise<string | undefined>;
  saveNames(id: string, text: string): Promise<unknown>;
  books(query: Query): Promise<Listing>;
  tags(limit?: number): Promise<TagCount[]>;
  addBooks(files: (FileInfo & { text: string })[]): Promise<BookRecord[]>;
  book(id: string): Promise<BookRecord | null>;
  chapter(id: string, listed: Listed, raw?: boolean): Promise<Shown | null>;
  rereadBook(id: string): Promise<BookRecord | null>;
  deleteBook(id: string): Promise<void>;
  status(): Promise<LibraryStatus>;
  scan(): Promise<LibraryStatus>;
  search(q: string): Promise<BookSaying[]>;
  searchBook(q: string, id: string): Promise<{ indexed: boolean; total: number; mentions: Mention[] }>;
  characters(q: string): Promise<Person[]>;
  bookmarks(id: string): Promise<Bookmark[]>;
  findBookmarks(q: string, offset?: number, limit?: number): Promise<BookmarkListing>;
  addBookmark(id: string, offset: number, note?: string): Promise<Bookmark | null>;
  saveBookmarkNote(bookmarkId: number, note: string): Promise<Bookmark | null>;
  deleteBookmark(bookmarkId: number): Promise<void>;
}

export type LibraryStatus = {
  libraries: string[];
  books: number;
  scan: { running: boolean; files?: number; toRead?: number; read?: number; failed?: number; removed?: number; finishedAt?: string };
  index: { done: number; total: number };
};
export type BookSaying = { id: string; name: string; chapters: number };
export type Mention = { chapterId: string; title: string; offset: number; before: string; match: string; after: string };
export type Person = { name: string; mentions: number; books: { id: string; name: string; mentions: number }[] };
// a paragraph bookmarked: where it is in its book (as `?at=` says it), the words it begins with,
// as read (not corrected by the book's names), and the note it was given. `missing`: its book is
// not in the library (gone, or not scanned yet)
export type Bookmark = {
  id: number; bookId: string; offset: number; parser: number; chapterId: string | null; chapterTitle: string | null;
  bookName: string; quote: string; note: string; createdAt: string; updatedAt: string; missing?: boolean;
};
export type BookmarkListing = { total: number; offset: number; bookmarks: Bookmark[] };

// the server's: it reads the books and keeps them (see server/server.ts for its answers)
export function serverBackend(): Backend {
  // a body is sent as JSON, or as text when it is text; an answer of 404 is null
  let call = async (method: string, route: string, body?: unknown) => {
    let text = typeof body === 'string';
    let sent = body !== undefined && {
      headers: { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' },
      body: text ? (body as string) : JSON.stringify(body),
    };
    let response = await fetch(`/api/${route}`, { method, ...sent });
    // the answer is read whole, whatever it is: one left unread holds its connection, and
    // the next call over it is cut off
    let answer = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} /api/${route}: ${response.status} ${answer}`);
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
    books: (query) => call('GET', `books?${queryString(query)}`),
    tags: (limit = 40) => call('GET', `tags?limit=${limit}`),
    addBooks: (files) => Promise.all(files.map(file => call('POST', 'books', file))),
    book: (bookId) => call('GET', `books/${id(bookId)}`),
    chapter: (bookId, listed, raw) => call('GET', `books/${id(bookId)}/chapters/${id(listed.id)}${raw ? '?raw=1' : ''}`),
    rereadBook: (bookId) => call('POST', `books/${id(bookId)}/reread`),
    deleteBook: (bookId) => call('DELETE', `books/${id(bookId)}`),
    status: () => call('GET', 'library'),
    scan: () => call('POST', 'library/scan'),
    search: (q) => call('GET', `search?q=${id(q)}`),
    searchBook: (q, bookId) => call('GET', `search?q=${id(q)}&book=${id(bookId)}`),
    characters: (q) => call('GET', `characters?q=${id(q)}`),
    bookmarks: (bookId) => call('GET', `bookmarks?book=${id(bookId)}`),
    findBookmarks: (q, offset = 0, limit = 50) => call('GET', `bookmarks?q=${id(q)}&offset=${offset}&limit=${limit}`),
    addBookmark: (bookId, offset, note) => call('POST', 'bookmarks', { bookId, offset, note }),
    saveBookmarkNote: (bookmarkId, note) => call('PATCH', `bookmarks/${bookmarkId}`, { note }),
    deleteBookmark: (bookmarkId) => call('DELETE', `bookmarks/${bookmarkId}`),
  };
}
