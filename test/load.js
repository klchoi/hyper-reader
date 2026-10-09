// Loads the chapter parser out of hyper-reader.html, where it lives between the
// `@parser` and `@slug` markers, so the tests run the code the page runs.
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'hyper-reader.html'), 'utf8');

function between(start, end) {
  let from = html.indexOf(start);
  let to = html.indexOf(end);
  if(from < 0 || to < 0) throw new Error(`markers ${start} / ${end} not found in hyper-reader.html`);
  return html.slice(from, to);
}

function loadParser() {
  let code = between('// @parser:begin', '// @parser:end') + '\n' + between('// @slug:begin', '// @slug:end');
  let exports = ['extractChapters', 'normalizeFileContent', 'readNumberWords', 'cleanTitle', 'bookRecord', 'Book', 'chapterTitle', 'slug', 'PARSER_VERSION'];
  // the parser logs while it works; a test run should not
  let quiet = { log() {}, group() {}, groupCollapsed() {}, groupEnd() {}, table() {}, info() {} };
  return new Function('console', `${code}\nreturn { ${exports.join(', ')} };`)(quiet);
}

module.exports = { loadParser };
