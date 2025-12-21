import assert from 'node:assert';
import { test } from 'node:test';
import parseHanNumber from '../han-number.js';

const cases = [
  ['nhất', 1],
  ['thập', 10],
  ['thập nhị', 12],
  ['tam thập ngũ', 35],
  ['nhị thập tứ', 24],
  ['nhất bách', 100],
  ['nhất bách tam thập', 130],
  ['nhị bách ngũ thập lục', 256],
  ['tam thiên', 3000],
  ['nhất thiên tam bách nhị thập tứ', 1324],
  ['tứ thiên tam bách', 4300],
  ['ngũ vạn lục thiên', 56000],
  ['nhất vạn tam thiên bát bách tam thập lục', 13836]
];

for (const [input, expected] of cases) {
  test(`parseHanNumber("${input}") should return ${expected}`, () => {
    assert.strictEqual(parseHanNumber(input), expected);
  });
}
