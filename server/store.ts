// What the server keeps, in one SQLite database (node:sqlite): the books found in the libraries,
// their chapters, the characters named in them, where each was left, the settings, the names,
// and the full text of the chapters, indexed for search (FTS5). A book's text is not kept here:
// it stays in its file, and a chapter is cut from it at the offsets kept for it.
//
//   books        one row a file: where it is (`root`, the library, and `path` in it), what it is
//                called, its size and time (a file changed since is read again), the parser
//                that read it, and the one its text was indexed under (0: not yet)
//   chapters     a book's chapters in order, where each begins and ends in the text as read
//   characters   the names a book's text gives most often, and how often
//   chapter_text the chapters' text, folded (see `fold`), for search; contentless: the index
//                only, its rows are the chapters' rowids
//   progress, settings, names   as the page sends them; progress and names outlive their book,
//                so a file that comes back finds them again
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import type { Part } from '../src/parser.ts';
import { fold } from '../src/catalog.ts';

// what is searched is folded the same way on both sides. The index takes the text in lower case
// and with `đ` as `d`, which the tokenizer's removal of diacritics leaves as it is (the tones and
// the other marks it takes away itself); a name is kept with no marks at all, so `hoang dung`
// finds `Hoàng Dung`
export const foldForIndex = (text: string) => text.toLowerCase().replaceAll('đ', 'd');
export const plain = fold;

const MIGRATIONS = [
  `create table books (
    id text primary key,
    root text not null,
    path text not null,
    name text not null,
    description text,
    size integer not null,
    mtime real not null,
    parser integer not null,
    indexed integer not null default 0,
    chapter_count integer not null,
    added_at text not null,
    unique (root, path)
  );
  -- a rowid is never given again: an index row written for a chapter gone stays nobody's
  create table chapters (
    rowid integer primary key autoincrement,
    book_id text not null references books(id) on delete cascade,
    n integer not null,
    id text not null,
    title text not null,
    offset integer not null,
    "end" integer not null,
    grp text,
    part_of text,
    part_text text,
    unique (book_id, n)
  );
  create table characters (
    book_id text not null references books(id) on delete cascade,
    name text not null,
    folded text not null,
    mentions integer not null,
    primary key (book_id, name)
  );
  create index characters_folded on characters(folded);
  create table progress (book_id text primary key, record text not null);
  create table settings (key text primary key, value text not null);
  create table names (book_id text primary key, text text not null);
  create virtual table chapter_text using fts5(
    title, body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  -- a chapter gone takes its text out of the index, however it went (a book read again,
  -- deleted, or its file gone)
  create trigger chapter_gone after delete on chapters begin
    delete from chapter_text where rowid = old.rowid;
  end;`,
  // a part that is one of the chapters its whole runs over, the number of that chapter
  'alter table chapters add column part_chapter integer;',
  // ...which the parser no longer makes: a run of chapters is chapters
  'alter table chapters drop column part_chapter;',
];

function openStore(file: string) {
  let db = new DatabaseSync(file);
  // one writer at a time, readers alongside; a writer waits for another rather than failing
  db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 30000;');
  let version = db.prepare('pragma user_version').get()!.user_version as number;
  for(let at = version; at < MIGRATIONS.length; at++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[at]);
      db.exec(`pragma user_version = ${at + 1}`);
    });
  }
  return db;
}

// `work` all at once, or not at all
function transaction<T>(db: DatabaseSync, work: () => T) {
  db.exec('begin immediate');
  try {
    let result = work();
    db.exec('commit');
    return result;
  } catch(error) {
    db.exec('rollback');
    throw error;
  }
}

// a book's row as the page knows it: its record without the chapters
const BOOK_COLUMNS = 'id, root, path, name, description, size, mtime, parser, indexed, chapter_count as chapterCount';
export type BookRow = {
  id: string; root: string; path: string; name: string; description: string | null;
  size: number; mtime: number; parser: number; indexed: number; chapterCount: number;
};
export type ChapterRow = {
  rowid: number; n: number; id: string; title: string; offset: number; end: number;
  grp: string | null; part_of: string | null; part_text: string | null;
};
// a book as a reader reads it (see read-worker.ts): what it is called, its size and time, the
// parser that read it, its chapters (where each begins and ends in the text as read) and the
// names it gives most
export type BookRead = {
  name: string; description?: string; size: number; mtime: number; parser: number;
  chapters: { id: string; title: string; offset: number; end: number; group?: string; part?: Part }[];
  characters: { name: string; mentions: number }[];
};

export function createStore(file: string) {
  let db = openStore(file);
  let statements = new Map<string, StatementSync>();
  // each statement is prepared once, the first time it is run
  let sql = (text: string) => {
    if(!statements.has(text)) statements.set(text, db.prepare(text));
    return statements.get(text)!;
  };

  let store = {
    db,
    close: () => db.close(),
    transaction: <T>(work: () => T) => transaction(db, work),

    // ---- books
    books: () => sql(`select ${BOOK_COLUMNS} from books order by name`).all() as BookRow[],
    booksIn: (root: string) => sql(`select ${BOOK_COLUMNS} from books where root = ?`).all(root) as BookRow[],
    book: (id: string) => (sql(`select ${BOOK_COLUMNS} from books where id = ?`).get(id) ?? null) as BookRow | null,
    chapters: (id: string) => sql('select rowid, n, id, title, offset, "end", grp, part_of, part_text from chapters where book_id = ? order by n').all(id) as ChapterRow[],
    // a book read: its row, and its chapters and characters in place of what it had
    keepBook({ id, root, path, name, description, size, mtime, parser, chapters, characters }: BookRead & { id: string; root: string; path: string }) {
      transaction(db, () => {
        sql('delete from chapters where book_id = ?').run(id);
        sql('delete from characters where book_id = ?').run(id);
        sql(`insert into books (id, root, path, name, description, size, mtime, parser, indexed, chapter_count, added_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
             on conflict (id) do update set root = excluded.root, path = excluded.path, name = excluded.name,
               description = excluded.description, size = excluded.size, mtime = excluded.mtime,
               parser = excluded.parser, indexed = 0, chapter_count = excluded.chapter_count`)
          .run(id, root, path, name, description ?? null, size, mtime, parser, chapters.length, new Date().toISOString());
        let chapter = sql('insert into chapters (book_id, n, id, title, offset, "end", grp, part_of, part_text) values (?, ?, ?, ?, ?, ?, ?, ?, ?)');
        chapters.forEach((c, n) => chapter.run(id, n, c.id, c.title, c.offset, c.end, c.group ?? null, c.part?.of ?? null, c.part?.text ?? null));
        let character = sql('insert into characters (book_id, name, folded, mentions) values (?, ?, ?, ?)');
        for(let { name: who, mentions } of characters) character.run(id, who, plain(who), mentions);
      });
    },
    forgetBook: (id: string) => { sql('delete from books where id = ?').run(id); },

    // ---- what the page keeps
    progress() {
      let all: Record<string, unknown> = {};
      for(let { book_id, record } of sql('select book_id, record from progress').all() as { book_id: string; record: string }[]) all[book_id] = JSON.parse(record);
      return all;
    },
    saveProgress: (id: string, record: unknown) => { sql('insert into progress values (?, ?) on conflict (book_id) do update set record = excluded.record').run(id, JSON.stringify(record)); },
    settings() {
      let all: Record<string, unknown> = {};
      for(let { key, value } of sql('select key, value from settings').all() as { key: string; value: string }[]) all[key] = JSON.parse(value);
      return all;
    },
    saveSettings(settings: Record<string, unknown>) {
      transaction(db, () => {
        let setting = sql('insert into settings values (?, ?) on conflict (key) do update set value = excluded.value');
        for(let [key, value] of Object.entries(settings)) setting.run(key, JSON.stringify(value ?? null));
      });
    },
    names: (id: string) => sql('select text from names where book_id = ?').get(id)?.text as string | undefined,
    saveNames: (id: string, text: string) => { sql('insert into names values (?, ?) on conflict (book_id) do update set text = excluded.text').run(id, text); },

    // ---- the full text
    // the books still to index under this parser, in the order they came
    toIndex: (parser: number, limit: number) => (sql('select id from books where indexed != ? and parser = ? order by added_at limit ?').all(parser, parser, limit) as { id: string }[]).map(row => row.id),
    indexCount: (parser: number) => sql('select count(*) as total, coalesce(sum(indexed = ?), 0) as done from books').get(parser) as { total: number; done: number },
    // chapters into the index, in place of what was there: [{ rowid, title, body }]. A chapter
    // gone since its text was cut (its book read again) is left out
    indexChapters(chapters: { rowid: number; title: string; body: string }[]) {
      transaction(db, () => {
        let exists = sql('select 1 from chapters where rowid = ?');
        let remove = sql('delete from chapter_text where rowid = ?');
        let insert = sql('insert into chapter_text (rowid, title, body) values (?, ?, ?)');
        for(let { rowid, title, body } of chapters) {
          if(!exists.get(rowid)) continue;
          remove.run(rowid);
          insert.run(rowid, foldForIndex(title), foldForIndex(body));
        }
      });
    },
    // a book indexed, as long as it is still the book that was read
    markIndexed: ({ id, size, mtime }: BookRow, parser: number) => {
      sql('update books set indexed = ? where id = ? and size = ? and mtime = ? and parser = ?').run(parser, id, size, mtime, parser);
    },

    // ---- search
    // the characters whose names begin with `q`, as said in the books they are named in
    characters: (q: string, limit = 500) => {
      let key = plain(q.trim());
      return sql(`select c.name, c.mentions, b.id as bookId, b.name as bookName from characters c join books b on b.id = c.book_id
                  where c.folded >= ? and c.folded < ? order by c.mentions desc limit ?`).all(key, `${key}\uffff`, limit) as { name: string; mentions: number; bookId: string; bookName: string }[];
    },
    // the chapters a phrase is in: of one book, in order, or of the whole library, by book
    chaptersSaying: (phrase: string, bookId: string) => sql(`select c.rowid, c.n, c.id, c.title, c.offset, c."end", c.book_id as bookId from chapter_text
                  join chapters c on c.rowid = chapter_text.rowid where chapter_text match ? and c.book_id = ? order by c.n`).all(phrase, bookId) as (Omit<ChapterRow, 'grp' | 'part_of' | 'part_text'> & { bookId: string })[],
    booksSaying: (phrase: string, limit = 100) => sql(`select c.book_id as id, b.name, count(*) as chapters from chapter_text
                  join chapters c on c.rowid = chapter_text.rowid join books b on b.id = c.book_id
                  where chapter_text match ? group by c.book_id order by chapters desc limit ?`).all(phrase, limit) as { id: string; name: string; chapters: number }[],
  };
  return store;
}

export type Store = ReturnType<typeof createStore>;
