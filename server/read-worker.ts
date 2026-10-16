// A reader of books, in a process of its own (see readers.ts): a file read, its text as the
// parser reads it, and what the parser makes of it, the chapters and the names it gives most.
import fs from 'node:fs';
import path from 'node:path';
import { extractChapters, normalizeFileContent } from '../src/parser.ts';
import { Book, PARSER_VERSION } from '../src/book.ts';
import { findNames } from '../src/name-patterns.ts';
import type { BookRead } from './store.ts';
import { rawOffsets, rawText } from './raw.ts';

export type Asked = { id: number; kind: 'read' | 'text'; file: string };
export type Answered = { id: number; result?: BookRead | ReadText; error?: { message: string; code?: string } };
export type ReadText = { size: number; mtime: number; text: string };

// a file's text as the parser reads it, and the size and time it had when read
function readText(file: string): ReadText {
  let { size, mtimeMs } = fs.statSync(file);
  return { size, mtime: mtimeMs, text: normalizeFileContent(fs.readFileSync(file, 'utf8')) };
}

const jobs = {
  // the book in a file: what it is called, its chapters (where each begins and ends in the text
  // as read, and where it begins in the file's own, see raw.ts) and its characters
  read(file: string): BookRead {
    let { size, mtimeMs: mtime } = fs.statSync(file);
    let source = fs.readFileSync(file, 'utf8');
    let text = normalizeFileContent(source);
    let { name, description } = Book({ name: path.basename(file) });
    let chapters = extractChapters(name, text, { name });
    let raw = rawOffsets(rawText(source), text, chapters.map(c => c.offset));
    return {
      name, description, size, mtime, parser: PARSER_VERSION,
      chapters: chapters.map((c, i) => ({
        id: c.id, title: c.title, offset: c.offset, end: chapters[i + 1]?.offset ?? text.length, rawOffset: raw[i], group: c.group, part: c.part,
      })),
      characters: findNames(text),
    };
  },
  // the text of a file as the parser reads it, which a book's offsets count in
  text: (file: string) => readText(file),
};

process.on('message', ({ id, kind, file }: Asked) => {
  try {
    process.send!({ id, result: jobs[kind](file) } satisfies Answered);
  } catch(error) {
    let { message, code } = error as NodeJS.ErrnoException;
    process.send!({ id, error: { message: String(message), code } } satisfies Answered);
  }
});
// the server gone, its reader goes too
process.on('disconnect', () => process.exit());
process.send!({ ready: true });
