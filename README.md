# hyper-reader

A reader for long novels kept as `.txt` files. It is one page, `hyper-reader.html`: open it,
drop a book on it, and read by chapter. The page is built from `src/` (see Building it) and kept
in git as built, so it opens as it is. The books, where each was left and the settings are kept
by a backend, of which there are two: the browser's, or a small Node server's.

## Running it

In the browser alone: open `hyper-reader.html` from the file. The browser keeps everything
(IndexedDB), and a book is read in a worker, so a big one does not hold the page still; the
console says which way each book was read (`Chapters of "...": read in a worker`, or `... read
in the page (why)` when no worker could be had).

With the server: `npm start -- [--port 8080] [--data <folder>] [--library [name=]<folder>]...`,
then `http://127.0.0.1:8080/`. The server serves the page, and keeps the books in a SQLite
database, `<data>/library.db` (`data/` by default):

- the books of each library, a folder of `.txt` files (sub-folders too), read where they are and
  never written to or deleted. A library is known by its name, the folder's own if none is given,
  so a book keeps its id (and where it was left) wherever the folder is mounted. The libraries are
  scanned when the server starts and when asked (`POST /api/library/scan`): only what came,
  changed or went since the last scan is read again, so a scan of a library already read takes
  a moment;
- the books dropped on the page, kept in `<data>/uploads`, a library of their own, the only
  books that can be deleted from the page.

A book's id is its name and where it is (`tien-lo-xanh-biec-do-3fa9c21b`). The books are read on
threads of their own, and their full text indexed behind them for search (`/api/search?q=`,
`&book=` for every place in one book), a book opened first; the characters a book names most
are kept with it (`/api/characters?q=`). Where a book was left and its names outlive it, so a
file that goes and comes back finds them again. It needs nothing but Node (24, for `node:sqlite`),
answers on this computer only, and reads the parser when it starts. Listing the fonts installed
on the machine works here and not from the file.

The two keep their books apart: a book dropped on the page opened as a file is not on the
server, and the other way round.

## Building it

```
npm install
npm run build            src/ into one file: dist/hyper-reader.html, put in place as hyper-reader.html
npm run dev              src/ served as it changes (http://localhost:5173/hyper-reader.html), the
                         books left to the server (npm start)
```

The built page holds everything it needs, its libraries too, so it needs no network.

## What is in src/

- `hyper-reader.html`, `styles.css` the page and its styles.
- `parser.js` the chapter parser, a script with no imports or exports: the page runs it from its
  text, a worker is made from that text, and node loads it the same way (`lib/parser.js`) for the
  tests, the tools and the server. It touches nothing of the page.
- `book.js` what a book is (`Book`) and what is kept of it (`bookRecord`, `PARSER_VERSION`),
  run with the parser.
- `main.ts` the page started: the parser run from its text, the reader of books, and the app
  mounted on `<body>`.
- The app, in [Ripple](https://github.com/Ripple-TS/ripple) (TypeScript, `.tsrx`):
  - `App.tsrx` makes the store and lays the page out: `ChapterList`, `Library` or
    `ChapterText`, `Settings`, and the dialogs, `CommandPalette`, `FontPicker`,
    `NamesEditor`, and the `AddName` button.
  - `store.ts` everything the page knows, as tracked values, and the actions, the only things
    that write them. Made by App and handed down as a context.
  - `listening.ts` what the page listens for: the url, books dropped, the keys, the scroll, the
    pointer over a name.
  - `places.ts` the url, a place in a book, a chapter as its lines. `names.ts` the names list,
    the text corrected by it, the names coloured on the page.
- `name-patterns.js` how a name is told in the text: the patterns the page colours names by, and
  the faster reading of them the server keeps a book's characters by.
- `backends.ts` what the app asks of whatever keeps the books: the browser's backend
  (IndexedDB, and `reading.js`, which hands a book to a worker) and the server's (calls to
  `server/server.js`).

## The chapter parser

A book's headings are the lines whose numbers run in sequence. The parser reads every line that
could be a heading, then finds the best path through them: a number followed by the next one
scores, a jump costs, a book or a phiên ngoại may start the numbers over. A line that only looks
like a heading (`Một giờ sau...`) fits nowhere in the sequence and is left out.

The parser's own comments say the rest; start with the contents at the head of `src/parser.js`,
and `TUNING`, where every number it was tuned with is named.

A chapter is `{ id, title, offset, group, part, content }`, `part` being set on the parts of a
chapter written in several (`{ of, text }`: the chapter named once, and the part); what is stored of a book is
`bookRecord(book)`. Raise `PARSER_VERSION` when a change should reach the books already stored:
they are read again the next time they are opened.

## Working on it

```
npm test                 the tests: the parser, read from the page, on small invented books,
                         the worker, and the server's answers
npm start                the server
npm run lint             oxlint over all the code: src/, lib/, server/, test/, tools/
npm run typecheck        TypeScript over src/, the .tsrx too (tsrx-tsc)
npm run check:books -- <folder>
```

`lib/parser.js` loads the parser from `src/` for the tests, the tools and the server.

`check:books` runs the parser over a folder of `.txt` books and compares each with the snapshot it
saved earlier, naming the books a change moves and how (titles, groups, offsets). The first run, or
`--update`, saves the snapshot to `.books-snapshot.json`, which is not committed because it
describes a private library.

The usual round for a parser change:

1. Write the case that fails in `test/chapters.test.js`.
2. Change the parser until it passes.
3. `npm run check:books -- <folder>`: read what moved, and be sure it should have.
4. `npm run check:books -- <folder> --update` to keep the new state as the one to compare with.

Notes on the lint rules (`.oxlintrc.json`): oxlint's own set, with warnings failing the run, less
`unicorn/no-new-array` (`new Array(n).fill(x)` always means a length here). The parser's and the
book's functions are used from their text, so oxlint is told their names are used.
