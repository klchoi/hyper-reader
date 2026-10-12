// Reading a book takes a while when it is big, so it is done in a worker (parser-worker.ts),
// and the page stays where it was. Where no worker can be made, or one fails, the page reads the
// book itself. It asks nothing of the browser but the worker it is given, so the tests can give
// it one of node's threads (test/worker.test.ts).
import { Book } from './book.ts';
import { extractChapters, normalizeFileContent } from './parser.ts';
import type { Chapter } from './parser.ts';

// a book handed to the worker, and its answer: the chapters, or why there are none
export type Job = { id: number; name: string; text: string };
export type Answer = { id: number; chapters?: Chapter[]; error?: string };
// a worker that answers each job it is posted, or fails
export type MakeWorker = (answered: (answer: Answer) => void, failed: () => void) => { postMessage(job: Job): void; terminate(): void };

export function createReader({ makeWorker, console = globalThis.console }: { makeWorker?: MakeWorker; console?: Pick<Console, 'info'> } = {}) {
  let parserWorker: ReturnType<MakeWorker> | null | undefined;
  let reading = new Map<number, { name: string; text: string; resolve: (chapters: Chapter[]) => void }>();
  let readings = 0;

  // which way a book was read is said in the console, so a page opened from a file can tell
  function readInPage(name: string, text: string, why: string) {
    console.info(`Chapters of "${name}": read in the page (${why})`);
    return extractChapters(name, normalizeFileContent(text), { name });
  }

  function startParserWorker() {
    if (!makeWorker) return null;
    try {
      let worker = makeWorker(({ id, chapters, error }) => {
        let job = reading.get(id);
        reading.delete(id);
        if (!job) return;
        if (error || !chapters) job.resolve(readInPage(job.name, job.text, `the worker failed: ${error}`));
        else {
          console.info(`Chapters of "${job.name}": read in a worker`);
          job.resolve(chapters);
        }
      }, () => {
        // a worker that cannot run leaves its books to the page
        worker.terminate();
        parserWorker = null;
        for (let job of reading.values()) job.resolve(readInPage(job.name, job.text, 'the worker could not run'));
        reading.clear();
      });
      return worker;
    } catch (error) {
      console.info('No worker for the parser:', error);
      return null;
    }
  }

  // the chapters of a book's text
  function chaptersOf(name: string, text: string) {
    parserWorker ??= startParserWorker();
    if (!parserWorker) return Promise.resolve(readInPage(name, text, 'no worker could be made'));
    let worker = parserWorker;
    return new Promise<Chapter[]>(resolve => {
      let id = ++readings;
      reading.set(id, { name, text, resolve });
      worker.postMessage({ id, name, text });
    });
  }

  // a book with its text read: what its file says it is, and its chapters
  async function readBook(file: { name: string }, text: string) {
    let book = Book(file);
    return { ...book, chapters: await chaptersOf(book.name, text) };
  }

  return { readBook, stop: () => parserWorker?.terminate() };
}

export type Reader = ReturnType<typeof createReader>;
