// Loads the chapter parser out of hyper-reader.html, so the tests, the tools and the server run
// the code the page runs: the parser is the page's `<script id="chapter-parser">`, and what the
// page keeps of a book (Book, bookRecord) is marked off with `@book` in its main script. The
// page is read when the parser is loaded, so a parser loaded again is the page as it is now.
const fs = require('node:fs');
const path = require('node:path');

const PAGE = path.join(__dirname, '..', 'hyper-reader.html');

function parserScript(html = fs.readFileSync(PAGE, 'utf8')) {
  let found = /<script id="chapter-parser">([\s\S]*?)<\/script>/.exec(html);
  if(!found) throw new Error('no <script id="chapter-parser"> in hyper-reader.html');
  return found[1];
}

function bookCode(html) {
  let from = html.indexOf('// @book:begin');
  let to = html.indexOf('// @book:end');
  if(from < 0 || to < 0) throw new Error('markers @book:begin / @book:end not found in hyper-reader.html');
  return html.slice(from, to);
}

function loadParser() {
  let html = fs.readFileSync(PAGE, 'utf8');
  let code = `${parserScript(html)}\n${bookCode(html)}`;
  let exports = ['extractChapters', 'finishChapters', 'normalizeFileContent', 'readNumberWords', 'cleanTitle', 'bookRecord', 'Book', 'chapterTitle', 'slug', 'PARSER_VERSION'];
  // the parser logs while it works; a test run or a server should not
  let quiet = { log() {}, group() {}, groupCollapsed() {}, groupEnd() {}, table() {}, info() {} };
  return new Function('console', `${code}\nreturn { ${exports.join(', ')} };`)(quiet);
}

module.exports = { loadParser, parserScript, PAGE };
