// The indexer of the books' full text, on a thread of its own (index-worker.js): it works
// through every book not yet indexed, the one asked for first.
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createIndexer({ database, roots, onIndexed = () => {} }) {
  let worker = new Worker(path.join(__dirname, 'index-worker.js'), { workerData: { database, roots: [...roots] } });
  worker.on('message', (message) => {
    if(message.failed) console.error('Not indexed:', message.failed, message.error);
    else onIndexed(message.indexed);
  });
  worker.on('error', (error) => console.error('The indexer stopped:', error));
  return {
    // a book wanted soon (one opened), before the rest
    first: (id) => worker.postMessage({ first: id }),
    // books came in: there is work again
    nudge: () => worker.postMessage({}),
    close: () => worker.terminate(),
  };
}

module.exports = { createIndexer };
