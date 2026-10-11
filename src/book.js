// What a book is to the page, and what is kept of it. A script of its own, read with the parser
// (see src/parser.js): it uses its `slug`.

// bump when a change to the parser should reach the books already stored, which
// are parsed again the next time they are opened
const PARSER_VERSION = 12;

// a book: where it came from, and its chapters once the text has been read (see readBook)
function Book(file) {
  let id, name, description;
  if (file?.name) {
    name = /(?<name>^[^(]*).*?\.txt/.exec(file.name.normalize()).groups.name.trim();
    description = /(?<description>\(.*)\.txt/.exec(file?.name.normalize())?.groups?.description?.trim();
    id = slug(name);
  }
  return { id, name, description, chapters: undefined };
}

// what is stored of a book: the list of its chapters without their text, which is kept
// chapter by chapter
function bookRecord({ id, name, description, chapters }) {
  return { id, name, description, parser: PARSER_VERSION, chapters: chapters.map(({ content, ...listed }) => listed) };
}
