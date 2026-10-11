// Readers of books on threads of their own, as many as the machine has cores to spare, so a
// library of thousands is read in parallel and the server answers while it is. A job waits for
// the first reader free.
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');

function createReaders(count = Math.max(1, os.availableParallelism() - 1)) {
  let idle = [];
  let all = [];
  let waiting = [];   // jobs no reader has taken yet
  let pending = new Map();   // id -> { resolve, reject, worker }
  let jobs = 0;

  let start = () => {
    let worker = new Worker(path.join(__dirname, 'read-worker.js'));
    worker.on('message', ({ id, result, error }) => {
      let job = pending.get(id);
      pending.delete(id);
      if(error) job.reject(Object.assign(new Error(error.message), { code: error.code }));
      else job.resolve(result);
      next(worker);
    });
    // a reader that died takes its job with it, and is replaced
    worker.on('error', (error) => {
      for(let [id, job] of pending) {
        if(job.worker !== worker) continue;
        pending.delete(id);
        job.reject(error);
      }
      all = all.filter(w => w !== worker);
      idle = idle.filter(w => w !== worker);
      next(start());
    });
    all.push(worker);
    return worker;
  };
  let next = (worker) => {
    let job = waiting.shift();
    if(!job) return idle.push(worker);
    pending.set(job.id, { ...job, worker });
    worker.postMessage({ id: job.id, kind: job.kind, ...job.args });
  };
  for(let k = 0; k < count; k++) idle.push(start());

  let run = (kind, args) => new Promise((resolve, reject) => {
    waiting.push({ id: ++jobs, kind, args, resolve, reject });
    let worker = idle.shift();
    if(worker) next(worker);
  });

  return {
    // the book in a file
    read: (file) => run('read', { file }),
    // the text of a file as the parser reads it
    text: (file) => run('text', { file }),
    busy: () => waiting.length + pending.size,
    close: () => Promise.all(all.map(worker => worker.terminate())),
  };
}

module.exports = { createReaders };
