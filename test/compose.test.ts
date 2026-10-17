// The server of compose.yaml is started again on a change to what it runs of src/, and only that:
// an edit of the page would end the indexer in the middle of a book.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');

// the files of src/ the server's code takes, however far down (its workers' too)
function srcOfServer() {
  let seen = new Set<string>();
  let todo = fs.readdirSync(path.join(root, 'server')).filter(file => file.endsWith('.ts')).map(file => path.join(root, 'server', file));
  while(todo.length) {
    let file = todo.pop()!;
    if(seen.has(file)) continue;
    seen.add(file);
    for(let [, from, url] of fs.readFileSync(file, 'utf8').matchAll(/(?:from|import\()\s*'(\.[^']+)'|new URL\('(\.[^']+)'/g)) {
      let next = path.resolve(path.dirname(file), from ?? url);
      if(fs.existsSync(next)) todo.push(next);
    }
  }
  return [...seen].map(file => path.relative(root, file)).filter(file => file.startsWith('src/')).sort();
}

describe('the server of compose.yaml', () => {
  it('is started again on a change to what it runs of src/, and nothing else of it', () => {
    let watched = [...fs.readFileSync(path.join(root, 'compose.yaml'), 'utf8').matchAll(/--watch-path=(\S+)/g)].map(([, at]) => at);
    assert.ok(watched.includes('server'));
    assert.deepEqual(watched.filter(at => at.startsWith('src')).sort(), srcOfServer());
  });
});
