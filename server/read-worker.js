// A reader of books, on a thread of its own (see readers.js): a file read, its text as the
// parser reads it, and what the parser makes of it, the chapters and the names it gives most.
const { parentPort } = require('node:worker_threads');
const fs = require('node:fs');
const path = require('node:path');
const { loadParser } = require('../lib/parser.js');
const { findNames } = require('../src/name-patterns.js');

const parser = loadParser();

// a file's text as the parser reads it, and the size and time it had when read
function readText(file) {
  let { size, mtimeMs } = fs.statSync(file);
  return { size, mtime: mtimeMs, text: parser.normalizeFileContent(fs.readFileSync(file, 'utf8')) };
}

const jobs = {
  // the book in a file: what it is called, its chapters (where each begins and ends in the text
  // as read) and its characters
  read({ file }) {
    let { size, mtime, text } = readText(file);
    let { name, description } = parser.Book({ name: path.basename(file) });
    let chapters = parser.extractChapters(name, text, { name });
    return {
      name, description, size, mtime, parser: parser.PARSER_VERSION,
      chapters: chapters.map((c, i) => ({
        id: c.id, title: c.title, offset: c.offset, end: chapters[i + 1]?.offset ?? text.length, group: c.group, part: c.part,
      })),
      characters: findNames(text),
    };
  },
  // the text of a file as the parser reads it, which a book's offsets count in
  text: ({ file }) => readText(file),
};

parentPort.on('message', ({ id, kind, ...job }) => {
  try {
    parentPort.postMessage({ id, result: jobs[kind](job) });
  } catch(error) {
    parentPort.postMessage({ id, error: { message: String(error.message), code: error.code } });
  }
});
