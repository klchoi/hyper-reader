// The names of a chapter (src/marks.ts): its lines as the book's list corrects them, and where the
// names in them are, those of the list and those the text gives, each the name of somebody.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { aliasCandidates, anyOf, findMarks, linesOf, markChapter, nameFixer } from '../src/marks.ts';

// what is marked in `texts`, as [text, name, person, in the list]
const marked = (texts: string[], names: string) => findMarks(texts, names).marks
  .map(({ at, start, end, person, known }) => [at, texts[at].slice(start, end), person, known]);

describe('a chapter in lines', () => {
  it('keeps the offset each line has in the text as read, its names corrected', () => {
    let content = 'Mở đầu.\nNàng gặp hoang dung.<br>Hết.';
    assert.deepEqual(linesOf({ content, offset: 100 }, nameFixer('hoang dung -> Hoàng Dung')), [
      { text: 'Mở đầu.', offset: 100 },
      { text: 'Nàng gặp Hoàng Dung.', offset: 100 + 'Mở đầu.\n'.length },
      { text: 'Hết.', offset: 100 + 'Mở đầu.\nNàng gặp hoang dung.<br>'.length },
    ]);
  });
  it('marks the names where the corrected lines have them', () => {
    let { lines, marks } = markChapter({ content: 'Mở đầu.\nNàng gặp hoang dung.', offset: 0 }, 'hoang dung -> Hoàng Dung');
    assert.deepEqual(marks.map(({ at, start, end, known }) => [lines[at].text.slice(start, end), known]), [['Hoàng Dung', true]]);
  });
});

describe('the names in a chapter', () => {
  it('finds those of the list, a line of it one person, the short name of a full one too', () => {
    assert.deepEqual(marked(['Lý Tiêu Dao cười.', 'Tiêu Dao đi.'], 'Lý Tiêu Dao'), [
      [0, 'Lý Tiêu Dao', 'lý tiêu dao', true], [1, 'Tiêu Dao', 'lý tiêu dao', true],
    ]);
    assert.deepEqual(marked(['Dung Nhi cười với tỷ tỷ.'], 'Hoàng Dung, Dung Nhi (tỷ tỷ)'), [
      [0, 'Dung Nhi', 'hoàng dung', true], [0, 'tỷ tỷ', 'hoàng dung', true],
    ]);
  });
  it('finds the names the text gives, the end of a name being the same person', () => {
    let { marks, persons } = findMarks(['Hôm qua gặp Lý Mạc Sầu ở đây.', 'Rồi Mạc Sầu đi.'], '');
    assert.deepEqual(marks.map(mark => [mark.at, mark.person, mark.known]), [[0, 'lý mạc sầu', false], [1, 'lý mạc sầu', false]]);
    assert.deepEqual(persons, { 'lý mạc sầu': { ids: ['lý mạc sầu', 'mạc sầu'], short: [] } });
  });
  it('lets a name of the list win over a longer one the text gives around it', () => {
    assert.deepEqual(marked(['Hôm qua gặp Lý Tiêu Dao.'], 'Tiêu Dao'), [[0, 'Tiêu Dao', 'tiêu dao', true]]);
  });
  it('finds nothing with nothing to find', () => {
    assert.deepEqual(findMarks(['một ngày dài.'], ''), { marks: [], persons: {} });
  });
});

describe('who a name could be', () => {
  it('offers who of the list a name is made from, called fondly or by what they are', () => {
    let names = 'Bạch Linh\nLiễu Khánh Hà\nNgô Hàn';
    assert.deepEqual(aliasCandidates(names, 'Linh nhi'), ['Bạch Linh']);
    assert.deepEqual(aliasCandidates(names, 'Liễu di'), ['Liễu Khánh Hà']);
    assert.deepEqual(aliasCandidates(names, 'Liễu tỷ tỷ'), ['Liễu Khánh Hà']);
    assert.deepEqual(marked(['Nàng gặp Liễu di.'], names), [[0, 'Liễu di', 'liễu di', false]]);
  });
});

describe('any of some names', () => {
  it('finds whole words only, the longer name first', () => {
    assert.deepEqual([...'Lan an, an Nhiên'.matchAll(anyOf(['an', 'an nhiên']))].map(match => match[0]), ['an', 'an Nhiên']);
  });
});
