#!/usr/bin/env node
// Runs the parser over a folder of .txt books and compares what it makes of each with a
// snapshot saved earlier, so a change to the parser shows which books it moves.
//
//   node tools/check-books.ts <folder> [--update] [--snapshot <file>]
//
// The snapshot holds each chapter's title, group, offset and a hash of its text. It is kept
// out of git (.gitignore): it describes a private library.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { extractChapters, normalizeFileContent } from '../src/parser.ts';
import { Book } from '../src/book.ts';

// a book as the snapshot keeps it: each chapter's title, group, offset and the hash of its text
type Digest = [title: string, group: string | null, offset: number, hash: string][];
type Books = Record<string, Digest | { error: string }>;

function digestOf(folder: string, file: string): Digest {
  let { name } = Book({ name: file });
  let text = normalizeFileContent(fs.readFileSync(path.join(folder, file), 'utf8'));
  return extractChapters(name, text, { name }).map(c => [
    c.title, c.group ?? null, c.offset, crypto.createHash('md5').update(c.content).digest('hex').slice(0, 8),
  ]);
}

if(!isMainThread) {
  // a worker takes the books it is given and answers with their digests
  let { folder, files }: { folder: string; files: string[] } = workerData;
  let books: Books = {};
  for(let file of files) {
    try { books[file.normalize()] = digestOf(folder, file); }
    catch(error) { books[file.normalize()] = { error: String((error as Error).message) }; }
  }
  parentPort!.postMessage(books);
} else {
  main();
}

// the groups of a book in the order they come, each once in a row
function groupsOf(chapters: Digest) {
  let groups: string[] = [];
  for(let [, group] of chapters) if(group != null && group != groups.at(-1)) groups.push(group);
  return groups;
}
const show = (groups: string[]) => groups.length <= 4 ? `[${groups.join(', ')}]` : `[${groups.slice(0, 2).join(', ')}, ... ${groups.at(-2)}, ${groups.at(-1)}] (${groups.length})`;

async function main() {
  let args = process.argv.slice(2);
  let valueOf = (flag: string) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  let folder = args.find((a, i) => !a.startsWith('--') && args[i - 1] != '--snapshot');
  let update = args.includes('--update');
  let snapshotPath = valueOf('--snapshot') ?? path.join(import.meta.dirname, '..', '.books-snapshot.json');
  if(!folder) {
    console.error('usage: node tools/check-books.ts <folder> [--update] [--snapshot <file>]');
    process.exit(2);
  }

  // the biggest books first, dealt out to the workers in turn, so none is left with them all
  let files = fs.readdirSync(folder).filter(f => f.endsWith('.txt'))
    .sort((a, z) => fs.statSync(path.join(folder!, z)).size - fs.statSync(path.join(folder!, a)).size);
  let count = Math.max(1, Math.min(os.availableParallelism(), files.length));
  let shares = Array.from({ length: count }, (_, k) => files.filter((_, i) => i % count == k));
  let parts = await Promise.all(shares.map(share => new Promise<Books>((resolve, reject) => {
    let worker = new Worker(new URL(import.meta.url), { workerData: { folder, files: share } });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  let books: Books = Object.fromEntries(Object.entries(Object.assign({}, ...parts) as Books).sort(([a], [z]) => a.localeCompare(z)));

  if(update || !fs.existsSync(snapshotPath)) {
    fs.writeFileSync(snapshotPath, JSON.stringify(books));
    console.log(`saved ${Object.keys(books).length} books to ${snapshotPath}`);
    return;
  }

  let before: Record<string, Digest | undefined> = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  let changed = 0;
  for(let [file, chapters] of Object.entries(books)) {
    let was = before[file];
    if(JSON.stringify(was) == JSON.stringify(chapters)) continue;
    changed++;
    if(!was) { console.log(`new      ${file}`); continue; }
    if('error' in chapters) { console.log(`error    ${file}: ${chapters.error}`); continue; }
    let titles = new Set(was.map(c => c[0]));
    let now = new Set(chapters.map(c => c[0]));
    let gone = was.filter(c => !now.has(c[0])).length;
    let added = chapters.filter(c => !titles.has(c[0])).length;
    let moved = was.length == chapters.length ? was.filter((c, i) => c[2] != chapters[i][2]).length : null;
    let regrouped = was.length == chapters.length ? was.filter((c, i) => c[1] != chapters[i][1]).length : null;
    let notes = [`${was.length} -> ${chapters.length} chapters`, `${gone} titles gone`, `${added} new`];
    if(moved) notes.push(`${moved} moved`);
    if(regrouped) notes.push(`${regrouped} regrouped`);
    console.log(`changed  ${file}: ${notes.join(', ')}`);
    let [groupsWas, groupsNow] = [groupsOf(was), groupsOf(chapters)];
    if(groupsWas.join() != groupsNow.join()) console.log(`           groups ${show(groupsWas)} -> ${show(groupsNow)}`);
  }
  for(let file of Object.keys(before)) if(!(file in books)) console.log(`missing  ${file}`);
  console.log(changed ? `${changed} of ${Object.keys(books).length} books changed` : `all ${Object.keys(books).length} books unchanged`);
  process.exitCode = changed ? 1 : 0;
}
