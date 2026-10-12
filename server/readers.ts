// Readers of books, in processes of their own: as many at once as the machine has cores to spare,
// so a library of thousands is read in parallel and the server answers while it is. A job waits
// for the first reader free; a reader is started when a job finds none, and ends when it has
// been left without one for a while. Reading a big book takes a few hundred MB, and a process
// that ends gives them back: a thread's stay with the server, which would keep, idle, the most
// it ever read at once.
import os from 'node:os';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { BookRead } from './store.ts';
import type { Asked, Answered, ReadText } from './read-worker.ts';

// how long a reader is kept with nothing to do (ms)
const IDLE = 10_000;

// A helper process: node running `module`, told and telling by messages (cloned as between
// threads). It takes none of this process's own flags (a test runner's, a watcher's). What it is
// told before it says it is ready (`{ ready: true }`) waits for it: a message that came before it
// listened would be lost
export type Helper = { process: ChildProcess; send: (message: unknown) => void };
export function startHelper(module: URL, args: string[] = []): Helper {
  let child = fork(fileURLToPath(module), args, { serialization: 'advanced', execArgv: ['--disable-warning=ExperimentalWarning'] });
  let queued: unknown[] | null = [];
  child.on('message', (message: { ready?: boolean }) => {
    if(!message?.ready || !queued) return;
    for(let early of queued) child.send(early as object);
    queued = null;
  });
  return {
    process: child,
    send: (message) => {
      if(queued) queued.push(message);
      else if(child.connected) child.send(message as object);
    },
  };
}

type Job = { id: number; kind: Asked['kind']; file: string; resolve: (result: any) => void; reject: (error: Error) => void };
type Reader = Helper & { job: Job | null; timer?: ReturnType<typeof setTimeout> };

export function createReaders({ count = Math.max(1, os.availableParallelism() - 1), idle = IDLE } = {}) {
  let readers = new Set<Reader>();
  let waiting: Job[] = [];   // jobs no reader has taken yet
  let jobs = 0;

  let give = (reader: Reader, job: Job) => {
    clearTimeout(reader.timer);
    reader.job = job;
    reader.send({ id: job.id, kind: job.kind, file: job.file } satisfies Asked);
  };
  // a reader left with nothing to do goes, unless a job comes first
  let rest = (reader: Reader) => {
    reader.job = null;
    reader.timer = setTimeout(() => end(reader), idle);
  };
  let end = (reader: Reader) => {
    clearTimeout(reader.timer);
    readers.delete(reader);
    reader.process.kill();
  };
  // the jobs waiting to the readers free, and to new ones while there is room for more
  let dispatch = () => {
    for(let reader of readers) {
      if(!waiting.length) return;
      if(!reader.job) give(reader, waiting.shift()!);
    }
    while(waiting.length && readers.size < count) give(start(), waiting.shift()!);
  };
  let start = () => {
    let reader: Reader = { ...startHelper(new URL('./read-worker.ts', import.meta.url)), job: null };
    reader.process.on('message', (answered: Answered | { ready: true }) => {
      let job = reader.job;
      if(!('id' in answered) || job?.id !== answered.id) return;
      let { result, error } = answered;
      if(error) job.reject(Object.assign(new Error(error.message), { code: error.code }));
      else job.resolve(result);
      rest(reader);
      dispatch();
    });
    // a reader that died takes its job with it (one ended here had none); the jobs waiting
    // go to the others, or to a new one
    let stopped = (why: unknown) => {
      clearTimeout(reader.timer);
      if(!readers.delete(reader)) return;
      reader.job?.reject(new Error(`the reader stopped: ${why}`));
      reader.job = null;
      dispatch();
    };
    reader.process.on('exit', (code, signal) => stopped(signal ?? code));
    reader.process.on('error', (error) => stopped(error.message));
    readers.add(reader);
    return reader;
  };

  let run = <T>(kind: Asked['kind'], file: string) => new Promise<T>((resolve, reject) => {
    waiting.push({ id: ++jobs, kind, file, resolve, reject });
    dispatch();
  });

  return {
    // the book in a file
    read: (file: string) => run<BookRead>('read', file),
    // the text of a file as the parser reads it
    text: (file: string) => run<ReadText>('text', file),
    busy: () => waiting.length + [...readers].filter(reader => reader.job).length,
    // how many readers there are, busy or not
    running: () => readers.size,
    close: () => Promise.all([...readers].map(reader => new Promise<void>(resolve => {
      if(reader.process.exitCode != null || reader.process.signalCode != null) return resolve();
      reader.process.once('exit', () => resolve());
      end(reader);
    }))),
  };
}
