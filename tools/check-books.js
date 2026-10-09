#!/usr/bin/env node
// Runs the parser over a folder of .txt books and compares what it makes of each with a
// snapshot saved earlier, so a change to the parser shows which books it moves.
//
//   node tools/check-books.js <folder> [--update] [--snapshot <file>]
//
// The snapshot holds each chapter's title, group, offset and a hash of its text. It is kept
// out of git (.gitignore): it describes a private library.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');

function digestOf(parser, folder, file) {
  let name = /(?<name>^[^(]*).*?\.txt/.exec(file.normalize()).groups.name.trim();
  let text = parser.normalizeFileContent(fs.readFileSync(path.join(folder, file), 'utf8'));
  return parser.extractChapters(name, text, { name }).map(c => [
    c.title, c.group ?? null, c.offset, crypto.createHash('md5').update(c.content).digest('hex').slice(0, 8),
  ]);
}

if(!isMainThread) {
  // a worker takes the books it is given and answers with their digests
  let { folder, files } = workerData;
  let parser = require('../test/load.js').loadParser();
  let books = {};
  for(let file of files) {
    try { books[file.normalize()] = digestOf(parser, folder, file); }
    catch(error) { books[file.normalize()] = { error: String(error.message) }; }
  }
  parentPort.postMessage(books);
} else {
  main();
}

async function main() {
  let args = process.argv.slice(2);
  let valueOf = (flag) => args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  let folder = args.find((a, i) => !a.startsWith('--') && args[i - 1] != '--snapshot');
  let update = args.includes('--update');
  let snapshotPath = valueOf('--snapshot') ?? path.join(__dirname, '..', '.books-snapshot.json');
  if(!folder) {
    console.error('usage: node tools/check-books.js <folder> [--update] [--snapshot <file>]');
    process.exit(2);
  }

  // the biggest books first, dealt out to the workers in turn, so none is left with them all
  let files = fs.readdirSync(folder).filter(f => f.endsWith('.txt'))
    .sort((a, z) => fs.statSync(path.join(folder, z)).size - fs.statSync(path.join(folder, a)).size);
  let count = Math.max(1, Math.min(os.availableParallelism(), files.length));
  let shares = Array.from({ length: count }, (_, k) => files.filter((_, i) => i % count == k));
  let parts = await Promise.all(shares.map(share => new Promise((resolve, reject) => {
    let worker = new Worker(__filename, { workerData: { folder, files: share } });
    worker.once('message', resolve);
    worker.once('error', reject);
  })));
  let books = Object.fromEntries(Object.entries(Object.assign({}, ...parts)).sort(([a], [z]) => a.localeCompare(z)));

  if(update || !fs.existsSync(snapshotPath)) {
    fs.writeFileSync(snapshotPath, JSON.stringify(books));
    console.log(`saved ${Object.keys(books).length} books to ${snapshotPath}`);
    return;
  }

  let before = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  let changed = 0;
  for(let [file, chapters] of Object.entries(books)) {
    let was = before[file];
    if(JSON.stringify(was) == JSON.stringify(chapters)) continue;
    changed++;
    if(!was) { console.log(`new      ${file}`); continue; }
    if(chapters.error) { console.log(`error    ${file}: ${chapters.error}`); continue; }
    let titles = new Set(was.map(c => c[0]));
    let gone = was.filter(c => !chapters.some(d => d[0] == c[0])).length;
    let added = chapters.filter(c => !titles.has(c[0])).length;
    console.log(`changed  ${file}: ${was.length} -> ${chapters.length} chapters, ${gone} titles gone, ${added} new`);
  }
  for(let file of Object.keys(before)) if(!(file in books)) console.log(`missing  ${file}`);
  console.log(changed ? `${changed} of ${Object.keys(books).length} books changed` : `all ${Object.keys(books).length} books unchanged`);
  process.exitCode = changed ? 1 : 0;
}
