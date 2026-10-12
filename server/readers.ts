// Readers of books on threads of their own, as many as the machine has cores to spare, so a
// library of thousands is read in parallel and the server answers while it is. A job waits for
// the first reader free.
import os from 'node:os';
import { Worker } from 'node:worker_threads';
import type { BookRead } from './store.ts';
import type { Asked, Answered, ReadText } from './read-worker.ts';

type Job = { id: number; kind: Asked['kind']; file: string; resolve: (result: any) => void; reject: (error: Error) => void };

export function createReaders(count = Math.max(1, os.availableParallelism() - 1)) {
  let idle: Worker[] = [];
  let all: Worker[] = [];
  let waiting: Job[] = [];   // jobs no reader has taken yet
  let pending = new Map<number, Job & { worker: Worker }>();
  let jobs = 0;

  let start = () => {
    let worker = new Worker(new URL('./read-worker.ts', import.meta.url));
    worker.on('message', ({ id, result, error }: Answered) => {
      let job = pending.get(id)!;
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
  let next = (worker: Worker) => {
    let job = waiting.shift();
    if(!job) return idle.push(worker);
    pending.set(job.id, { ...job, worker });
    worker.postMessage({ id: job.id, kind: job.kind, file: job.file } satisfies Asked);
  };
  for(let k = 0; k < count; k++) idle.push(start());

  let run = <T>(kind: Asked['kind'], file: string) => new Promise<T>((resolve, reject) => {
    waiting.push({ id: ++jobs, kind, file, resolve, reject });
    let worker = idle.shift();
    if(worker) next(worker);
  });

  return {
    // the book in a file
    read: (file: string) => run<BookRead>('read', file),
    // the text of a file as the parser reads it
    text: (file: string) => run<ReadText>('text', file),
    busy: () => waiting.length + pending.size,
    close: () => Promise.all(all.map(worker => worker.terminate())),
  };
}
