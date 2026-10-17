// The full text of the books, indexed for search (FTS5), in a database of its own beside library.db
// (see store.ts): <data>/index-<INDEX_VERSION>.db. It is by far the biggest of what the server
// keeps, and the one written to most, and it is made again from the files alone: it can be kept
// where it costs least (a folder without copy-on-write, another disk), and a new index is a new
// file, the old one deleted (`indexFile`), not millions of rows deleted one by one.
//
//   indexed      a book of library.db indexed, or being indexed: the size and time its file had
//                (a book whose file is not as kept in library.db is not indexed, whatever is
//                kept of it here), and whether all of it is
//   blocks       a book's file's text (see raw.ts) cut into pieces for the index, where each
//                begins and ends in it: cut where the chapters began when it was indexed, but
//                kept to the file, so whatever a newer parser makes of a book, its index stays
//   book_text    the blocks' text, folded (see `foldForIndex`), for search; contentless: the
//                index only, its rows are the blocks' rowids
//
// Only the indexer writes it (index-worker.ts), and nothing else of it: a write to one database
// of a connection with another attached holds both, so no connection that writes has the other
// attached. What is asked of both, the books with what is found in them, is asked of a third
// connection that only reads (`createSearch`), which in WAL waits on no one.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore, statementsOf, transaction } from './store.ts';

// bump when what the index holds of a file changes (`rawText` in raw.ts, the folding below, the
// tokenizer, how a text is cut into blocks): every book is indexed again, in a new file. A change
// to the parser (PARSER_VERSION), what it makes of a text included, leaves the index as it is
export const INDEX_VERSION = 2;

// the index's file in `data`; those of other indexes, which are deleted
export const indexFile = (data: string) => path.join(data, `index-${INDEX_VERSION}.db`);
export function deleteOtherIndexes(data: string) {
  for(let file of fs.readdirSync(data)) {
    let index = /^index-(\d+)\.db(?:-wal|-shm)?$/.exec(file);
    if(index && Number(index[1]) !== INDEX_VERSION) fs.rmSync(path.join(data, file), { force: true });
  }
}

// what is searched is folded the same way on both sides. The index takes the text in lower case
// and with `đ` as `d`, which the tokenizer's removal of diacritics leaves as it is (the tones and
// the other marks it takes away itself), so `hoang dung` finds `Hoàng Dung`
export const foldForIndex = (text: string) => text.toLowerCase().replaceAll('đ', 'd');

const MIGRATIONS = [
  `create table indexed (
    book_id text primary key,
    size integer not null,
    mtime real not null,
    done integer not null default 0
  );
  -- a rowid is never given again: an index row written for a block gone stays nobody's
  create table blocks (
    rowid integer primary key autoincrement,
    book_id text not null references indexed(book_id) on delete cascade,
    offset integer not null,
    "end" integer not null
  );
  create index blocks_book on blocks(book_id, offset);
  create virtual table book_text using fts5(
    body, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2'
  );
  -- a block gone takes its text out of the index, however it went
  create trigger block_gone after delete on blocks begin
    delete from book_text where rowid = old.rowid;
  end;
  -- the index's pieces merged once 8 of a size are there, not 4: of 400 MB of text, written in
  -- writes of 16 MB (see index-worker.ts), 1.5 GB written in place of 2.6 GB, the index no bigger
  -- and no slower to search (at 16, it is 70% bigger, for nothing less written)
  insert into book_text(book_text, rank) values('automerge', 8);`,
];

// a book as the index knows it: which, and the size and time of its file
type Book = { id: string; size: number; mtime: number };

// the index, as the indexer writes it
export function createIndexStore(file: string) {
  let db = openStore(file, MIGRATIONS);
  let sql = statementsOf(db);
  return {
    db,
    close: () => db.close(),
    // what the index holds of a book: of which file, and whether all of it
    indexed: (id: string) => (sql('select size, mtime, done from indexed where book_id = ?').get(id) ?? null) as { size: number; mtime: number; done: number } | null,
    // a book to be indexed anew: what the index held of it gone
    begin({ id, size, mtime }: Book) {
      transaction(db, () => {
        sql('delete from indexed where book_id = ?').run(id);
        sql('insert into indexed (book_id, size, mtime) values (?, ?, ?)').run(id, size, mtime);
      });
    },
    // how far into its file's text a book is indexed: where its last block ends
    indexedTo: (id: string) => (sql('select coalesce(max("end"), 0) as at from blocks where book_id = ?').get(id) as { at: number }).at,
    // blocks of a book into the index: [{ offset, end, body }]
    indexBlocks(id: string, blocks: { offset: number; end: number; body: string }[]) {
      transaction(db, () => {
        let block = sql('insert into blocks (book_id, offset, "end") values (?, ?, ?)');
        let insert = sql('insert into book_text (rowid, body) values (?, ?)');
        for(let { offset, end, body } of blocks) insert.run(block.run(id, offset, end).lastInsertRowid, foldForIndex(body));
      });
    },
    // a book indexed, all of it
    finish: (id: string) => { sql('update indexed set done = 1 where book_id = ?').run(id); },
    // books gone from library.db: what the index held of them gone too
    forget(ids: string[]) {
      transaction(db, () => {
        for(let id of ids) sql('delete from indexed where book_id = ?').run(id);
      });
    },
  };
}

export type IndexStore = ReturnType<typeof createIndexStore>;

// What is asked of library.db and the index together, on a connection of its own that only reads.
// What the index holds of a book counts only where its file is the one library.db has
export function createSearch(library: string, index: string) {
  let db = new DatabaseSync(library);
  db.exec('pragma busy_timeout = 30000;');
  db.prepare('attach database ? as ix').run(index);
  let sql = statementsOf(db);
  // the books of library.db and what the index holds of each, as long as it is of its file
  const OF_ITS_FILE = 'join ix.indexed i on i.book_id = b.id and i.size = b.size and i.mtime = b.mtime';
  return {
    close: () => db.close(),
    // whether all of a book is indexed
    isIndexed: (id: string) => !!sql(`select 1 from books b ${OF_ITS_FILE} where b.id = ? and i.done = 1`).get(id),
    // the books still to index, in the order they came
    toIndex: (limit: number) => (sql(`select b.id from books b left join ix.indexed i on i.book_id = b.id and i.size = b.size and i.mtime = b.mtime and i.done = 1
                                      where i.book_id is null order by b.added_at limit ?`).all(limit) as { id: string }[]).map(row => row.id),
    indexCount: () => sql(`select count(*) as total, coalesce(sum(i.done = 1), 0) as done from books b
                           left join ix.indexed i on i.book_id = b.id and i.size = b.size and i.mtime = b.mtime`).get() as { total: number; done: number },
    // the books the index holds that library.db has no more
    gone: () => (sql('select book_id as id from ix.indexed except select id from books').all() as { id: string }[]).map(row => row.id),
    // where a phrase is in one book: the blocks it is in, in order, where they are in its file
    blocksSaying: (phrase: string, bookId: string) => sql(`select k.offset, k."end" from ix.book_text t join ix.blocks k on k.rowid = t.rowid
                  join books b on b.id = k.book_id ${OF_ITS_FILE} where t.book_text match ? and k.book_id = ? order by k.offset`).all(phrase, bookId) as { offset: number; end: number }[],
    // the books a phrase is in, and in how many of their chapters: a block's chapter is the one
    // it begins in (blocks are cut where the chapters began when the book was indexed)
    booksSaying: (phrase: string, limit = 100) => sql(`select k.book_id as id, b.name, count(distinct coalesce((select c.n from chapters c
                    where c.book_id = k.book_id and c.raw_offset <= k.offset order by c.raw_offset desc limit 1), -1)) as chapters
                  from ix.book_text t join ix.blocks k on k.rowid = t.rowid join books b on b.id = k.book_id ${OF_ITS_FILE}
                  where t.book_text match ? group by k.book_id order by chapters desc limit ?`).all(phrase, limit) as { id: string; name: string; chapters: number }[],
  };
}

export type Search = ReturnType<typeof createSearch>;
