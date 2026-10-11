// The parser and what a book is, run from their text (see src/parser.js), as the node side does
// in lib/parser.js: the names they give the page are listed here.
export const EXPORTS = ['extractChapters', 'finishChapters', 'normalizeFileContent', 'readNumberWords', 'cleanTitle', 'bookRecord', 'Book', 'chapterTitle', 'slug', 'latinize', 'PARSER_VERSION'];

export function loadParser(parserSource, bookSource, console = globalThis.console) {
  return new Function('console', `${parserSource}\n${bookSource}\nreturn { ${EXPORTS.join(', ')} };`)(console);
}
