// The indexer of the books' full text, in a process of its own (index-worker.ts): it works
// through every book not yet indexed, the one asked for first, and is ended once none is left,
// giving back what the books took to index (see readers.ts). A book read, or one asked for before
// it is indexed, starts it again.
import type { Helper } from './readers.ts';
import { startHelper } from './readers.ts';
import type { Told } from './index-worker.ts';

export function createIndexer({ database, index, roots, onIndexed = () => {} }: { database: string; index: string; roots: Map<string, string>; onIndexed?: (id: string) => void }) {
  let helper: Helper | null = null;
  // what this indexer was told: it is ended only when it says it is idle having heard all of it,
  // so nothing told it is lost on the way
  let sent = 0;
  let start = () => {
    let started = startHelper(new URL('./index-worker.ts', import.meta.url), [JSON.stringify({ database, index, roots: [...roots] })]);
    started.process.on('message', (message: Told | { ready: true }) => {
      if('ready' in message) return;
      if('idle' in message) {
        if(helper === started && message.idle === sent) end();
      }
      else if('failed' in message) console.error('Not indexed:', message.failed, message.error);
      else onIndexed(message.indexed);
    });
    let stopped = (why: unknown) => {
      if(helper !== started) return;
      helper = null;
      console.error('The indexer stopped:', why);
    };
    started.process.on('exit', (code, signal) => stopped(signal ?? code));
    started.process.on('error', (error) => stopped(error.message));
    sent = 0;
    return started;
  };
  let end = () => {
    let ended = helper;
    helper = null;
    ended?.process.kill();
    return ended;
  };
  let tell = (message: { first?: string }) => {
    helper ??= start();
    sent++;
    helper.send(message);
  };
  return {
    // a book wanted soon (one opened), before the rest
    first: (id: string) => tell({ first: id }),
    // books came in: there is work again
    nudge: () => tell({}),
    // whether it is there, at work or about to be ended
    running: () => helper !== null,
    close: () => new Promise<void>(resolve => {
      let ended = end();
      if(!ended || ended.process.exitCode != null || ended.process.signalCode != null) return resolve();
      ended.process.once('exit', () => resolve());
    }),
  };
}
