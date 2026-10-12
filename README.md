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

A book's id is its name and where it is (`tien-lo-xanh-biec-do-3fa9c21b`), and its place in the
page a path (`/books/<id>?at=<offset>`), which the server answers with the page. The books are read in
processes of their own, and their full text indexed behind them for search (`/api/search?q=`,
`&book=` for every place in one book), a book opened first; the processes end when they have
nothing left to do, and with them the memory a big book takes to read (a few hundred MB), so
the server waits on little (~40-60 MB, and the text of the book being read). The characters a book names most
are kept with it (`/api/characters?q=`). Where a book was left and its names outlive it, so a
file that goes and comes back finds them again. It needs nothing but Node (24, for `node:sqlite`
and for running TypeScript as it is written), answers on this computer only, and runs the page's
own parser (`src/parser.ts`). Listing the fonts installed
on the machine works here and not from the file.

The two keep their books apart: a book dropped on the page opened as a file is not on the
server, and the other way round.

### In a container

The server, with the page built in, is an image: `ghcr.io/klchoi/hyper-reader`, published by
`.github/workflows/image.yml` for every push to master (`latest`, and `sha-<commit>`), once the
checks pass. The books are mounted at `/books`, read-only, and what the server keeps (the
database, and the books dropped on the page) at `/data`, a folder of the machine's own, so it
outlives the container. It runs as any user that may write to that folder:

```
docker run -d --user 1000:1000 -v /path/to/books:/books:ro -v /path/to/data:/data \
  -p 127.0.0.1:8080:8080 ghcr.io/klchoi/hyper-reader --library=novels=/books [--allow-host <name>]
```

The arguments are the server's. Given none, it reads `/books` as the library `books`; given any,
they name the library too (`--library=<name>=/books`: the name is part of each book's id, so it
is the one to keep when the folder moves). It has no logins of its
own: put it behind a proxy that asks who is asking, and give the server the name the proxy is
reached by (`--allow-host reader.example.com`), which it answers along with its own; the page
may be served over https there. `docker stop` closes it at once (a scan going on is taken up
again by the next start).

## Building it

```
npm install
npm run build            src/ into one file: dist/index.html, put in place as hyper-reader.html
npm run dev              src/ served as it changes (http://localhost:5173/), the books left to
                         the server (npm start)
```

The built page holds everything it needs, its libraries too, so it needs no network.

### In containers, with nothing to restart

```
LIBRARY=/path/to/books docker compose up       then http://localhost:5173/
```

`compose.yaml` runs the working copy, mounted into two containers, so an edit on this machine
is taken up where it is:

- `web`, Vite: a change to src/ reaches the page open in the browser as you save it (styles and
  components in place, without a reload)
- `api`, the server under `node --watch`: a change to server/ or src/ (the parser) starts it
  again, in a second; the page keeps what it shows

The containers are made from the Dockerfile's `dev` image. The books of `LIBRARY` (it may go in
`.env`) are mounted read-only, as the library `books`; what the server keeps is in the volume
`data`. Both answer on this computer only (127.0.0.1). The
dependencies are installed in the image for Linux, in a volume of their own (the ones of this
machine stay out of it), and again when `package-lock.json` changes, the next time the
containers start. `docker compose down -v` leaves nothing behind but the image. Both are told of an edit by the
mount (OrbStack and Docker Desktop tell); where one does not, `POLL=1 docker compose up` has
Vite look for changes, and the server is started again with `docker compose restart api`.

## What is in src/

- `index.html`, `styles.css` the page and its styles (built into `hyper-reader.html`).
- `parser.ts` the chapter parser. It touches nothing of the page and nothing of node, so the
  page, its worker, and node (the tests, the tools, the server) all run it as it is.
- `book.ts` what a book is (`Book`) and what is kept of it (`bookRecord`, `PARSER_VERSION`).
- `reading.ts` the page's reader of books, which hands a book to a worker (`parser-worker.ts`,
  built into the page as a script of its own) and reads it in the page when no worker can run.
- `main.ts` the page started: the reader of books, and the app mounted on `<body>`.
- The app, in [Ripple](https://github.com/Ripple-TS/ripple) (TypeScript, `.tsrx`):
  - `App.tsrx` makes the store and lays the page out: `ChapterList`, `Library` or
    `ChapterText`, the `Rail` down the right (back to the library, the book's buttons, and the
    cog), and the dialogs: `Settings` (the theme, the page's width, and the fonts, in
    `FontPicker`), `CommandPalette`, `NamesEditor`, and the `AddName` button.
  - `store.ts` everything the page knows, as tracked values, and the actions, the only things
    that write them. Made by App and handed down as a context.
  - `listening.ts` what the page listens for: the url, books dropped, the keys, the scroll, the
    pointer over a name.
  - `places.ts` the url, a place in a book, a chapter as its lines. `names.ts` the names list,
    the text corrected by it, the names coloured on the page.
- `name-patterns.ts` how a name is told in the text: the patterns the page colours names by, and
  the faster reading of them the server keeps a book's characters by.
- `backends.ts` what the app asks of whatever keeps the books: the browser's backend
  (IndexedDB, and the reader of books) and the server's (calls to `server/server.ts`).

## The chapter parser

A book's headings are the lines whose numbers run in sequence. The parser reads every line that
could be a heading, then finds the best path through them: a number followed by the next one
scores, a jump costs, a book or a phiên ngoại may start the numbers over. A line that only looks
like a heading (`Một giờ sau...`) fits nowhere in the sequence and is left out.

The parser's own comments say the rest; start with the contents at the head of `src/parser.ts`,
and `TUNING`, where every number it was tuned with is named.

A chapter is `{ id, title, offset, group, part, content }`, `part` being set on the parts of a
chapter written in several (`{ of, text }`: the chapter named once, and the part); what is stored of a book is
`bookRecord(book)`. Raise `PARSER_VERSION` when a change should reach the books already stored:
they are read again the next time they are opened.

## Working on it

```
npm test                 the tests: the parser, read from the page, on small invented books,
                         the worker, the server's readers, and the server's answers
npm start                the server
npm run lint             oxlint over all the code: src/, server/, test/, tools/
npm run typecheck        TypeScript over the page (src/, the .tsrx too, with tsrx-tsc) and over
                         what node runs (server/, test/, tools/, with tsc)
npm run check:books -- <folder>
```

All of it is TypeScript. Node runs it as written, taking the types out as it loads it, so
nothing is compiled for node, and what node runs keeps to the TypeScript it can strip
(`erasableSyntaxOnly`: no enums, no namespaces) and imports its types with `import type`. The
server, the tests and the tools import the parser from `src/` as the page does.

`check:books` runs the parser over a folder of `.txt` books and compares each with the snapshot it
saved earlier, naming the books a change moves and how (titles, groups, offsets). The first run, or
`--update`, saves the snapshot to `.books-snapshot.json`, which is not committed because it
describes a private library.

The usual round for a parser change:

1. Write the case that fails in `test/chapters.test.ts`.
2. Change the parser until it passes.
3. `npm run check:books -- <folder>`: read what moved, and be sure it should have.
4. `npm run check:books -- <folder> --update` to keep the new state as the one to compare with.

Notes on the lint rules (`.oxlintrc.json`): oxlint's own set, with warnings failing the run, less
`unicorn/no-new-array` (`new Array(n).fill(x)` always means a length here), and with the
properties left out of a rest (`{ content, ...listed }`) counted as used.
