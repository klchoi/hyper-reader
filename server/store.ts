// What the server keeps, in three SQLite databases (node:sqlite), by what it would take to lose
// each:
//
// - <data>/reader.db, what the reader keeps (`createReaderStore`): where each book was left, the
//   settings, the names corrected. Small, written to little, and made of nothing else: this is
//   the one to keep a copy of.
// - <data>/library.db, what is known of the books (`createStore`): the books found in the
//   libraries, their chapters, the characters named in them. Made again from the files by a
//   scan, a few minutes. A book's text is not kept here: it stays in its file, and a chapter is
//   cut from it at the offsets kept for it.
// - <data>/index-<INDEX_VERSION>.db, the full text indexed for search (see index-store.ts): by far
//   the biggest, and the one written to most. Made again from the files by the indexer, behind
//   everything else; a new index is a new file, the old one deleted.
//
// library.db:
//
//   books        one row a file: where it is (`root`, the library, and `path` in it), what it is
//                called, its size and time (a file changed since is read again), and the parser
//                that read it
//   chapters     a book's chapters in order, where each begins and ends in the text as read,
//                and where it begins in the file's own (see raw.ts)
//   characters   the names a book's text gives most often, and how often
//
// reader.db:
//   progress, settings, names   as the page sends them; progress and names outlive their book,
//                so a file that comes back finds them again
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import type { StatementSync } from 'node:sqlite';
import type { Part } from '../src/parser.ts';
import { fold } from '../src/catalog.ts';

// a name is kept with no marks at all, so `hoang dung` finds `Hoàng Dung` (see index-store.ts for
// the full text)
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
  // the index kept to the text, not to the chapters (see `blocks` above): a parser that reads a
  // book into other chapters no longer has it indexed again. Every book is, this once
  `drop trigger chapter_gone;
  drop table chapter_text;
  create index chapters_offset on chapters(book_id, offset);
  -- a rowid is never given again: an index row written for a block gone stays nobody's
  create table blocks (
    rowid integer primary key autoincrement,
    book_id text not null references books(id) on delete cascade,
    offset integer not null,
    "end" integer not null
  );
  create index blocks_book on blocks(book_id, offset);
  create virtual table book_text using fts5(
    body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  -- a block gone takes its text out of the index, however it went (its file changed, the book
  -- deleted, or its file gone)
  create trigger block_gone after delete on blocks begin
    delete from book_text where rowid = old.rowid;
  end;
  update books set indexed = 0;`,
  // ...to the file's own text, not to what the parser makes of it (see raw.ts): where each
  // chapter begins in it, and the index again, of the file's text this time
  `alter table chapters add column raw_offset integer;
  drop index chapters_offset;
  create index chapters_raw on chapters(book_id, raw_offset);
  drop trigger block_gone;
  drop table book_text;
  drop table blocks;
  create table blocks (
    rowid integer primary key autoincrement,
    book_id text not null references books(id) on delete cascade,
    offset integer not null,
    "end" integer not null
  );
  create index blocks_book on blocks(book_id, offset);
  create virtual table book_text using fts5(
    body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  create trigger block_gone after delete on blocks begin
    delete from book_text where rowid = old.rowid;
  end;
  update books set indexed = 0;`,
  // what the reader keeps, kept in reader.db (see `createReaderStore`, which takes it from here
  // first)
  'drop table if exists progress; drop table if exists settings; drop table if exists names;',
  // a book the indexer was stopped in the middle of is taken up where it was left, not begun again
  'alter table books add column indexing integer not null default 0;',
  // the index's pieces merged once 8 of a size are there, not 4: of 400 MB of text, written in
  // writes of 16 MB (see index-worker.ts), 1.5 GB written in place of 2.6 GB, the index no bigger
  // and no slower to search (at 16, it is 70% bigger, for nothing less written)
  `insert into book_text(book_text, rank) values('automerge', 8);`,
  // the full text kept in a database of its own (see index-store.ts), and indexed again there
  `drop trigger block_gone;
  drop table book_text;
  drop table blocks;
  alter table books drop column indexed;
  alter table books drop column indexing;`,
];

export function openStore(file: string, migrations: string[]) {
  let db = new DatabaseSync(file);
  // one writer at a time, readers alongside; a writer waits for another rather than failing. The
  // log, as big as a write of the indexer once written back, is cut back to 64 MB, not left so
  db.exec('pragma journal_mode = wal; pragma synchronous = normal; pragma foreign_keys = on; pragma busy_timeout = 30000; pragma journal_size_limit = 67108864;');
  let version = db.prepare('pragma user_version').get()!.user_version as number;
  for(let at = version; at < migrations.length; at++) {
    transaction(db, () => {
      db.exec(migrations[at]);
      db.exec(`pragma user_version = ${at + 1}`);
    });
  }
  return db;
}

// `work` all at once, or not at all
export function transaction<T>(db: DatabaseSync, work: () => T) {
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
const BOOK_COLUMNS = 'id, root, path, name, description, size, mtime, parser, chapter_count as chapterCount';
export type BookRow = {
  id: string; root: string; path: string; name: string; description: string | null;
  size: number; mtime: number; parser: number; chapterCount: number;
};
export type ChapterRow = {
  rowid: number; n: number; id: string; title: string; offset: number; end: number; raw_offset: number | null;
  grp: string | null; part_of: string | null; part_text: string | null;
};
// a book as a reader reads it (see read-worker.ts): what it is called, its size and time, the
// parser that read it, its chapters (where each begins and ends in the text as read, and where it
// begins in the file's own) and the names it gives most
export type BookRead = {
  name: string; description?: string; size: number; mtime: number; parser: number;
  chapters: { id: string; title: string; offset: number; end: number; rawOffset: number; group?: string; part?: Part }[];
  characters: { name: string; mentions: number }[];
};

// each statement of a database prepared once, the first time it is run
export function statementsOf(db: DatabaseSync) {
  let statements = new Map<string, StatementSync>();
  return (text: string) => {
    if(!statements.has(text)) statements.set(text, db.prepare(text));
    return statements.get(text)!;
  };
}

export function createStore(file: string) {
  let db = openStore(file, MIGRATIONS);
  let sql = statementsOf(db);

  let store = {
    db,
    close: () => db.close(),
    transaction: <T>(work: () => T) => transaction(db, work),

    // ---- books
    books: () => sql(`select ${BOOK_COLUMNS} from books order by name`).all() as BookRow[],
    booksIn: (root: string) => sql(`select ${BOOK_COLUMNS} from books where root = ?`).all(root) as BookRow[],
    book: (id: string) => (sql(`select ${BOOK_COLUMNS} from books where id = ?`).get(id) ?? null) as BookRow | null,
    chapters: (id: string) => sql('select rowid, n, id, title, offset, "end", raw_offset, grp, part_of, part_text from chapters where book_id = ? order by n').all(id) as ChapterRow[],
    // a book read: its row, and its chapters and characters in place of what it had, only what is
    // not as it was written (a book read again is mostly the same). Its index is the indexer's
    // (see index-store.ts): kept as long as its file is the one indexed, whatever the parser made
    // of it
    keepBook({ id, root, path, name, description, size, mtime, parser, chapters, characters }: BookRead & { id: string; root: string; path: string }) {
      transaction(db, () => {
        let was = !!sql('select 1 from books where id = ?').get(id);
        sql(`insert into books (id, root, path, name, description, size, mtime, parser, chapter_count, added_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             on conflict (id) do update set root = excluded.root, path = excluded.path, name = excluded.name,
               description = excluded.description, size = excluded.size, mtime = excluded.mtime, parser = excluded.parser,
               chapter_count = excluded.chapter_count`)
          .run(id, root, path, name, description ?? null, size, mtime, parser, chapters.length, new Date().toISOString());
        let kept = was ? store.chapters(id) : [];
        let insert = sql('insert into chapters (book_id, n, id, title, offset, "end", raw_offset, grp, part_of, part_text) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        let update = sql('update chapters set id = ?, title = ?, offset = ?, "end" = ?, raw_offset = ?, grp = ?, part_of = ?, part_text = ? where rowid = ?');
        chapters.forEach((c, n) => {
          let row = [c.id, c.title, c.offset, c.end, c.rawOffset, c.group ?? null, c.part?.of ?? null, c.part?.text ?? null] as const;
          let k = kept[n];
          if(!k) insert.run(id, n, ...row);
          else if([k.id, k.title, k.offset, k.end, k.raw_offset, k.grp, k.part_of, k.part_text].some((value, at) => value !== row[at])) update.run(...row, k.rowid);
        });
        if(kept.length > chapters.length) sql('delete from chapters where book_id = ? and n >= ?').run(id, chapters.length);
        let had = was ? sql('select name, mentions from characters where book_id = ? order by name').all(id) as { name: string; mentions: number }[] : [];
        let now = [...characters].sort((a, z) => a.name < z.name ? -1 : a.name > z.name ? 1 : 0);
        if(had.length !== now.length || had.some((c, n) => c.name !== now[n].name || c.mentions !== now[n].mentions)) {
          sql('delete from characters where book_id = ?').run(id);
          let character = sql('insert into characters (book_id, name, folded, mentions) values (?, ?, ?, ?)');
          for(let { name: who, mentions } of characters) character.run(id, who, plain(who), mentions);
        }
      });
    },
    forgetBook: (id: string) => { sql('delete from books where id = ?').run(id); },

    // ---- for the indexer
    // where a book's chapters begin in its file's text, for a book read before it was kept
    // (its chapters as they are: none read again meanwhile)
    keepRawOffsets(chapters: { rowid: number; raw_offset: number }[]) {
      transaction(db, () => {
        let update = sql('update chapters set raw_offset = ? where rowid = ?');
        for(let { rowid, raw_offset } of chapters) update.run(raw_offset, rowid);
      });
    },
    // ---- search
    // the characters whose names begin with `q`, as said in the books they are named in
    characters: (q: string, limit = 500) => {
      let key = plain(q.trim());
      return sql(`select c.name, c.mentions, b.id as bookId, b.name as bookName from characters c join books b on b.id = c.book_id
                  where c.folded >= ? and c.folded < ? order by c.mentions desc limit ?`).all(key, `${key}\uffff`, limit) as { name: string; mentions: number; bookId: string; bookName: string }[];
    },
  };
  return store;
}

export type Store = ReturnType<typeof createStore>;

const READER_MIGRATIONS = [
  `create table progress (book_id text primary key, record text not null);
  create table settings (key text primary key, value text not null);
  create table names (book_id text primary key, text text not null);`,
];

// What the reader keeps (see above). Kept in library.db until it was kept here: taken from there,
// once, where `library` (library.db) has it still
export function createReaderStore(file: string, { library }: { library?: string } = {}) {
  let db = openStore(file, READER_MIGRATIONS);
  let sql = statementsOf(db);
  if(library && fs.existsSync(library)) takeFrom(db, library);

  return {
    db,
    close: () => db.close(),
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

  };
}

export type ReaderStore = ReturnType<typeof createReaderStore>;

// the reader's tables of an older library.db into reader.db, and out of library.db: what is
// there already is kept (a copy taken by a server stopped before it could take them out)
function takeFrom(db: DatabaseSync, library: string) {
  db.prepare('attach database ? as library').run(library);
  try {
    let tables = (db.prepare("select name from library.sqlite_master where type = 'table' and name in ('progress', 'settings', 'names')").all() as { name: string }[]).map(row => row.name);
    if(!tables.length) return;
    transaction(db, () => {
      for(let table of tables) db.exec(`insert or ignore into main.${table} select * from library.${table}`);
    });
    // (a second transaction: two databases are not written all at once, or not at all, together)
    transaction(db, () => {
      for(let table of tables) db.exec(`drop table library.${table}`);
    });
  } finally {
    db.exec('detach database library');
  }
}
