import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { parseChapter } from '../parse-chapter.js';

const filePath = path.resolve('./chapters.txt');
const content = fs.readFileSync(filePath, 'utf8');

// Split into test blocks (each starts with an input line followed by output lines)
const blocks = content
  .split(/\n\s*\n/)
  .map(block => block.trim())
  .filter(Boolean);

// Parses the output key-value block into an object
function parseExpected(lines) {
  const result = {};
  for (const line of lines) {
    const [key, ...rest] = line.split(':');
    if (key && rest.length) {
      const value = rest.join(':').trim();
      const normalizedKey = key.trim();
      let parsedValue;
      // Try parse value to number if possible
      if (!Number.isNaN(Number(value))) {
        parsedValue = Number(value);
      } else {
        parsedValue = value;
      }

      // Handle repeated keys (e.g. multiple `title:` lines)
      if (result[normalizedKey]) {
        if (Array.isArray(result[normalizedKey])) {
          result[normalizedKey].push(parsedValue);
        } else {
          result[normalizedKey] = [result[normalizedKey], parsedValue];
        }
      } else {
        result[normalizedKey] = parsedValue;
      }
    }
  }
  return result;
}

// Define one test per block
for (let i = 0; i < blocks.length; i++) {
  const lines = blocks[i].split('\n').map(l => l.trim()).filter(Boolean);
  const input = lines[0];
  const expected = parseExpected(lines.slice(1));

  test(input, () => {
    const actual = parseChapter(input);
    assert.deepEqual(actual, expected);
  });
}
