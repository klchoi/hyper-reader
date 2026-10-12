// What a book is, and what is kept of it: the same to the page and to the server.
import { slug } from './parser.ts';
import type { Chapter, Listed } from './parser.ts';

// bump when a change to the parser should reach the books already stored, which
// are parsed again the next time they are opened
export const PARSER_VERSION = 12;

export type BookInfo = { id: string; name: string; description?: string };
// what is kept of a book: the list of its chapters, without their text
export type BookRecord = BookInfo & { parser: number; chapters: Listed[] };

// a book: what its file is called says what it is, and its chapters once the text has been
// read (see readBook in reading.ts)
export function Book(file: { name: string }): BookInfo & { chapters?: Chapter[] } {
  let name = /(?<name>^[^(]*).*?\.txt/.exec(file.name.normalize())?.groups?.name.trim() ?? file.name;
  let description = /(?<description>\(.*)\.txt/.exec(file.name.normalize())?.groups?.description?.trim();
  return { id: slug(name), name, description, chapters: undefined };
}

// what is stored of a book: the list of its chapters without their text, which is kept
// chapter by chapter
export function bookRecord({ id, name, description, chapters }: BookInfo & { chapters: Chapter[] }): BookRecord {
  return { id, name, description, parser: PARSER_VERSION, chapters: chapters.map(({ content, ...listed }) => listed) };
}
