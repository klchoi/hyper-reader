// Reading a book takes a while when it is big, so it is done in a worker, made from the parser's
// own script, and the page stays where it was. Where no worker can be made, or one fails, the
// page reads the book itself. Plain JavaScript, so the tests can run it with node's threads
// standing in for the browser's worker (test/worker.test.js).
//
// `parserSource` is the parser's text (src/parser.js), `parser` the same run here (see
// load-parser.js); `Worker`, `Blob` and `URL` are the browser's.
export function createReader({ parserSource, parser, Worker = globalThis.Worker, Blob = globalThis.Blob, URL = globalThis.URL, console = globalThis.console }) {
  let parserWorker;
  let reading = new Map();   // id -> { name, text, resolve }
  let readings = 0;

  // which way a book was read is said in the console, so a page opened from a file can tell
  function readInPage(name, text, why) {
    console.info(`Chapters of "${name}": read in the page (${why})`);
    return parser.extractChapters(name, parser.normalizeFileContent(text), { name });
  }

  function startParserWorker() {
    try {
      let glue = `
        self.onmessage = ({ data: { id, name, text } }) => {
          try { postMessage({ id, chapters: extractChapters(name, normalizeFileContent(text), { name }) }); }
          catch (error) { postMessage({ id, error: String(error?.message ?? error) }); }
        };`;
      let worker = new Worker(URL.createObjectURL(new Blob([parserSource + glue], { type: 'text/javascript' })));
      worker.onmessage = ({ data: { id, chapters, error } }) => {
        let job = reading.get(id);
        reading.delete(id);
        if (error) job?.resolve(readInPage(job.name, job.text, `the worker failed: ${error}`));
        else {
          console.info(`Chapters of "${job?.name}": read in a worker`);
          job?.resolve(chapters);
        }
      };
      // a worker that cannot run leaves its books to the page
      worker.onerror = () => {
        worker.terminate();
        parserWorker = null;
        for (let job of reading.values()) job.resolve(readInPage(job.name, job.text, 'the worker could not run'));
        reading.clear();
      };
      return worker;
    } catch (error) {
      console.info('No worker for the parser:', error);
      return null;
    }
  }

  // the chapters of a book's text
  function chaptersOf(name, text) {
    parserWorker ??= startParserWorker();
    if (!parserWorker) return Promise.resolve(readInPage(name, text, 'no worker could be made'));
    return new Promise(resolve => {
      let id = ++readings;
      reading.set(id, { name, text, resolve });
      parserWorker.postMessage({ id, name, text });
    });
  }

  // a book with its text read: the file, and its chapters
  async function readBook(file, text) {
    let book = parser.Book(file);
    book.chapters = await chaptersOf(book.name, text);
    return book;
  }

  return { readBook, stop: () => parserWorker?.terminate() };
}
