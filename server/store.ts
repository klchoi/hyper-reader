// What the server keeps, in one SQLite database (node:sqlite): the books found in the libraries,
// their chapters, the characters named in them, where each was left, the settings, the names,
// and the full text of the chapters, indexed for search (FTS5). A book's text is not kept here:
// it stays in its file, and a chapter is cut from it at the offsets kept for it.
//
//   books        one row a file: where it is (`root`, the library, and `path` in it), what it is
//                called, its size and time (a file changed since is read again), the parser
//                that read it, and the index its text was indexed under (0: not yet)
//   chapters     a book's chapters in order, where each begins and ends in the text as read,
//                and where it begins in the file's own (see raw.ts)
//   characters   the names a book's text gives most often, and how often
//   blocks       a book's file's text (see raw.ts) cut into pieces for the index, where each
//                begins and ends in it: cut where the chapters began when it was indexed, but
//                kept to the file, so whatever a newer parser makes of a book, its index stays
//   book_text    the blocks' text, folded (see `fold`), for search; contentless: the index
//                only, its rows are the blocks' rowids
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

// bump when what the index holds of a file changes (`rawText` in raw.ts, the folding above, the
// tokenizer, how a text is cut into blocks): every book is indexed again. A change to the parser
// (PARSER_VERSION), what it makes of a text included, leaves the index as it is
export const INDEX_VERSION = 2;

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
    chapters: (id: string) => sql('select rowid, n, id, title, offset, "end", raw_offset, grp, part_of, part_text from chapters where book_id = ? order by n').all(id) as ChapterRow[],
    // a book read: its row, and its chapters and characters in place of what it had. Its index
    // is kept as long as its file is the one indexed, whatever the parser made of it
    keepBook({ id, root, path, name, description, size, mtime, parser, chapters, characters }: BookRead & { id: string; root: string; path: string }) {
      transaction(db, () => {
        let was = sql('select size, mtime, indexed from books where id = ?').get(id) as { size: number; mtime: number; indexed: number } | undefined;
        let same = !!was && was.size === size && was.mtime === mtime;
        if(!same) sql('delete from blocks where book_id = ?').run(id);
        sql('delete from characters where book_id = ?').run(id);
        sql(`insert into books (id, root, path, name, description, size, mtime, parser, indexed, chapter_count, added_at)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             on conflict (id) do update set root = excluded.root, path = excluded.path, name = excluded.name,
               description = excluded.description, size = excluded.size, mtime = excluded.mtime,
               parser = excluded.parser, indexed = excluded.indexed, chapter_count = excluded.chapter_count`)
          .run(id, root, path, name, description ?? null, size, mtime, parser, same ? was!.indexed : 0, chapters.length, new Date().toISOString());
        sql('delete from chapters where book_id = ?').run(id);
        let chapter = sql('insert into chapters (book_id, n, id, title, offset, "end", raw_offset, grp, part_of, part_text) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        chapters.forEach((c, n) => chapter.run(id, n, c.id, c.title, c.offset, c.end, c.rawOffset, c.group ?? null, c.part?.of ?? null, c.part?.text ?? null));
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
    // the books still to index under this index, in the order they came
    toIndex: (index: number, limit: number) => (sql('select id from books where indexed != ? order by added_at limit ?').all(index, limit) as { id: string }[]).map(row => row.id),
    indexCount: (index: number) => sql('select count(*) as total, coalesce(sum(indexed = ?), 0) as done from books').get(index) as { total: number; done: number },
    // where a book's chapters begin in its file's text, for a book read before it was kept
    // (its chapters as they are: none read again meanwhile)
    keepRawOffsets(chapters: { rowid: number; raw_offset: number }[]) {
      transaction(db, () => {
        let update = sql('update chapters set raw_offset = ? where rowid = ?');
        for(let { rowid, raw_offset } of chapters) update.run(raw_offset, rowid);
      });
    },
    // a book's blocks, and what the index holds of them, gone: it is to be indexed anew
    unindex: (id: string) => { sql('delete from blocks where book_id = ?').run(id); },
    // blocks of a book into the index: [{ offset, end, body }], as long as it is still the book
    // that was read (false: it is not, and was left as it is)
    indexBlocks({ id, size, mtime }: BookRow, blocks: { offset: number; end: number; body: string }[]) {
      return transaction(db, () => {
        if(!sql('select 1 from books where id = ? and size = ? and mtime = ?').get(id, size, mtime)) return false;
        let block = sql('insert into blocks (book_id, offset, "end") values (?, ?, ?)');
        let insert = sql('insert into book_text (rowid, body) values (?, ?)');
        for(let { offset, end, body } of blocks) insert.run(block.run(id, offset, end).lastInsertRowid, foldForIndex(body));
        return true;
      });
    },
    // a book indexed, as long as it is still the book that was read
    markIndexed: ({ id, size, mtime }: BookRow, index: number) => {
      sql('update books set indexed = ? where id = ? and size = ? and mtime = ?').run(index, id, size, mtime);
    },

    // ---- search
    // the characters whose names begin with `q`, as said in the books they are named in
    characters: (q: string, limit = 500) => {
      let key = plain(q.trim());
      return sql(`select c.name, c.mentions, b.id as bookId, b.name as bookName from characters c join books b on b.id = c.book_id
                  where c.folded >= ? and c.folded < ? order by c.mentions desc limit ?`).all(key, `${key}\uffff`, limit) as { name: string; mentions: number; bookId: string; bookName: string }[];
    },
    // where a phrase is in one book: the blocks it is in, in order, where they are in its file
    blocksSaying: (phrase: string, bookId: string) => sql(`select k.offset, k."end" from book_text join blocks k on k.rowid = book_text.rowid
                  where book_text match ? and k.book_id = ? order by k.offset`).all(phrase, bookId) as { offset: number; end: number }[],
    // the books a phrase is in, and in how many of their chapters: a block's chapter is the one
    // it begins in (blocks are cut where the chapters began when the book was indexed)
    booksSaying: (phrase: string, limit = 100) => sql(`select k.book_id as id, b.name, count(distinct coalesce((select c.n from chapters c
                    where c.book_id = k.book_id and c.raw_offset <= k.offset order by c.raw_offset desc limit 1), -1)) as chapters
                  from book_text join blocks k on k.rowid = book_text.rowid join books b on b.id = k.book_id
                  where book_text match ? group by k.book_id order by chapters desc limit ?`).all(phrase, limit) as { id: string; name: string; chapters: number }[],
  };
  return store;
}

export type Store = ReturnType<typeof createStore>;
