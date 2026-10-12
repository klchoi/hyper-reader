// The indexer of the books' full text, on a thread of its own (index-worker.ts): it works
// through every book not yet indexed, the one asked for first.
import { Worker } from 'node:worker_threads';
import type { Told } from './index-worker.ts';

export function createIndexer({ database, roots, onIndexed = () => {} }: { database: string; roots: Map<string, string>; onIndexed?: (id: string) => void }) {
  let worker = new Worker(new URL('./index-worker.ts', import.meta.url), { workerData: { database, roots: [...roots] } });
  worker.on('message', (message: Told) => {
    if('failed' in message) console.error('Not indexed:', message.failed, message.error);
    else onIndexed(message.indexed);
  });
  worker.on('error', (error) => console.error('The indexer stopped:', error));
  return {
    // a book wanted soon (one opened), before the rest
    first: (id: string) => worker.postMessage({ first: id }),
    // books came in: there is work again
    nudge: () => worker.postMessage({}),
    close: () => worker.terminate(),
  };
}
