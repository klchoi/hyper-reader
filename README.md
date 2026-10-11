# hyper-reader

A reader for long novels kept as `.txt` files. It is one page, `hyper-reader.html`: open it,
drop a book on it, and read by chapter. Books and reading progress are kept in the browser
(IndexedDB).

## Running it

Open `hyper-reader.html` in a browser, from the file or from a local server
(`python3 -m http.server`, then `http://localhost:8000/hyper-reader.html`). A book is read in a
worker, so a big one does not hold the page still; the console says which way each book was
read (`Chapters of "...": read in a worker`, or `... read in the page (why)` when no worker
could be had). Listing the fonts installed on the machine needs the local server.

## What is in the page

- `<script id="chapter-parser">` the chapter parser. It touches nothing of the page, so a worker
  can be made from its text, and the tests load it from here.
- `<script type="module">` the page: the app, the stored data, and `readBook`, which hands a book
  to the worker.

## The chapter parser

A book's headings are the lines whose numbers run in sequence. The parser reads every line that
could be a heading, then finds the best path through them: a number followed by the next one
scores, a jump costs, a book or a phiên ngoại may start the numbers over. A line that only looks
like a heading (`Một giờ sau...`) fits nowhere in the sequence and is left out.

The parser's own comments say the rest; start with the contents at the head of its script, and
`TUNING`, where every number it was tuned with is named.

A chapter is `{ id, title, offset, group, part, content }`, `part` being set on the parts of a
chapter written in several (`{ of, text }`: the chapter named once, and the part); what is stored of a book is
`bookRecord(book)`. Raise `PARSER_VERSION` when a change should reach the books already stored:
they are read again the next time they are opened.

## Working on it

```
npm test                 the tests: the parser, read from the page, on small invented books
npm run lint             Biome over the parser (node tools/lint.js --all adds the page)
npm run check:books -- <folder>
```

`check:books` runs the parser over a folder of `.txt` books and compares each with the snapshot it
saved earlier, naming the books a change moves and how (titles, groups, offsets). The first run, or
`--update`, saves the snapshot to `.books-snapshot.json`, which is not committed because it
describes a private library.

The usual round for a parser change:

1. Write the case that fails in `test/chapters.test.js`.
2. Change the parser until it passes.
3. `npm run check:books -- <folder>`: read what moved, and be sure it should have.
4. `npm run check:books -- <folder> --update` to keep the new state as the one to compare with.

Notes on the lint rules: `biome.json` turns off `useConst` (the code uses `let` throughout) and
`useNumberNamespace` (it writes `-Infinity`). The page itself, as against the parser, still has
findings of its own, most of them `==` against values that may be null, which is why `lint` checks
only the parser by default.
