// Loads the chapter parser for node, so the tests, the tools and the server run the code the page
// runs: src/parser.js, and what the page keeps of a book (Book, bookRecord) in src/book.js, run
// from their text as the page runs them (src/load-parser.js). They are read when a parser is
// loaded, so one loaded again is the parser as it is now.
const fs = require('node:fs');
const path = require('node:path');

const SOURCES = ['parser.js', 'book.js'].map(name => path.join(__dirname, '..', 'src', name));
const PAGE = path.join(__dirname, '..', 'hyper-reader.html');
const EXPORTS = ['extractChapters', 'finishChapters', 'normalizeFileContent', 'readNumberWords', 'cleanTitle', 'bookRecord', 'Book', 'chapterTitle', 'slug', 'latinize', 'PARSER_VERSION'];

function parserScript() {
  return fs.readFileSync(SOURCES[0], 'utf8');
}

function loadParser() {
  let [parser, book] = SOURCES.map(file => fs.readFileSync(file, 'utf8'));
  // the parser logs while it works; a test run or a server should not
  let quiet = { log() {}, group() {}, groupCollapsed() {}, groupEnd() {}, table() {}, info() {} };
  return new Function('console', `${parser}\n${book}\nreturn { ${EXPORTS.join(', ')} };`)(quiet);
}

module.exports = { loadParser, parserScript, SOURCES, PAGE };
