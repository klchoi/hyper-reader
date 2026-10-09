#!/usr/bin/env node
// Lints the page's scripts with Biome (rules in biome.json). Biome reads JavaScript, not HTML,
// so each <script> is written out to a temporary file, padded with blank lines so that the
// line Biome reports is the line in hyper-reader.html.
//
//   node tools/lint.js          the chapter parser, which the tests cover
//   node tools/lint.js --all    the page too, which has findings of its own (see the README)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

let root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'hyper-reader.html'), 'utf8');
let dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hyper-reader-lint-'));
let files = [];
let all = process.argv.includes('--all');

for(let match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
  let id = /id="([^"]+)"/.exec(match[1])?.[1] ?? (/type="module"/.test(match[1]) ? 'page' : 'script');
  let line = html.slice(0, match.index + match[0].indexOf('>') + 1).split('\n').length;
  if(!all && id != 'chapter-parser') continue;
  let file = path.join(dir, `${id}.${/type="module"/.test(match[1]) ? 'mjs' : 'js'}`);
  fs.writeFileSync(file, '\n'.repeat(line - 1) + match[2]);
  files.push(file);
}

let result = spawnSync('npx', ['--yes', '@biomejs/biome@1', 'lint', `--config-path=${root}`, '--max-diagnostics=200', ...files], { stdio: 'inherit' });
fs.rmSync(dir, { recursive: true, force: true });
process.exit(result.status ?? 1);
