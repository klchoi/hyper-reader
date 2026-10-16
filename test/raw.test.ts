// Where the chapters the parser finds begin in a file's own text, which the index is kept to.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rawOffsets, rawText } from '../server/raw.ts';
import { extractChapters, normalizeFileContent } from '../src/parser.ts';

const body = (n: number) => Array.from({ length: 6 }, (_, k) => `Dòng ${k} của chương ${n} , trời mưa  mãi không thôi .`).join('\r\n\r\n');

describe('a chapter in the file\'s text', () => {
  it('is found where its heading is, however the parser spaced and cut the text', () => {
    let source = ['Sách thử', ...[1, 2, 3].map(n => `\t Chương ${n}  :  Tiêu đề ${n}\r\n\r\n${body(n)}`)].join('\r\n\r\n\r\n');
    let raw = rawText(source);
    let text = normalizeFileContent(source);
    let chapters = extractChapters('Sách thử', text, { name: 'Sách thử' });
    let at = rawOffsets(raw, text, chapters.map(c => c.offset));
    assert.equal(at[0], 0);
    for(let n = 1; n <= 3; n++) assert.equal(at[n], raw.indexOf(`Chương ${n}`));
  });
  it('is put in proportion between those found, where it cannot be found', () => {
    let raw = 'aaaa Chương một bbbb xxxxxxxxxx Chương ba cccc';
    let text = 'aaaa Chương một bbbb yyyyyyyyyy Chương ba cccc';
    let at = rawOffsets(raw, text, [0, 5, 21, 32]);
    assert.deepEqual([at[0], at[1], at[3]], [0, 5, 32]);
    assert.equal(at[2], 21);
  });
  it('is the same text in another Unicode form', () => {
    assert.equal(rawText('Hoàng'), 'Hoàng');
  });
});
