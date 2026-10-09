// Loads the chapter parser out of hyper-reader.html, so the tests run the code the page
// runs: the parser is the page's `<script id="chapter-parser">`, and what the page keeps of a
// book (Book, bookRecord) is marked off with `@book` in its main script.
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'hyper-reader.html'), 'utf8');

function parserScript() {
  let found = /<script id="chapter-parser">([\s\S]*?)<\/script>/.exec(html);
  if(!found) throw new Error('no <script id="chapter-parser"> in hyper-reader.html');
  return found[1];
}

function bookCode() {
  let from = html.indexOf('// @book:begin');
  let to = html.indexOf('// @book:end');
  if(from < 0 || to < 0) throw new Error('markers @book:begin / @book:end not found in hyper-reader.html');
  return html.slice(from, to);
}

function loadParser() {
  let code = parserScript() + '\n' + bookCode();
  let exports = ['extractChapters', 'normalizeFileContent', 'readNumberWords', 'cleanTitle', 'bookRecord', 'Book', 'chapterTitle', 'slug', 'PARSER_VERSION'];
  // the parser logs while it works; a test run should not
  let quiet = { log() {}, group() {}, groupCollapsed() {}, groupEnd() {}, table() {}, info() {} };
  return new Function('console', `${code}\nreturn { ${exports.join(', ')} };`)(quiet);
}

module.exports = { loadParser, parserScript };
