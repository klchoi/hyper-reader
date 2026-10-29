// The names of a chapter (src/marks.ts): its lines as the book's list corrects them, and where the
// names in them are, those of the list and those the text gives, each the name of somebody.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { findNames } from '../src/name-patterns.ts';
import { aliasCandidates, anyOf, findMarks, genderSaid, linesOf, listedPerson, markChapter, nameFixer, namesWith, namesWithGender, piecesSaying } from '../src/marks.ts';

// what is marked in `texts`, as [text, name, person, in the list]
const marked = (texts: string[], names: string, bookNames?: string[]) => findMarks(texts, names, bookNames).marks
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
  it('finds a name the sentences open with, when they open with it more than once', () => {
    assert.deepEqual(marked(['Lâm Phong cười. Lâm Phong đi.'], ''), [
      [0, 'Lâm Phong', 'lâm phong', false], [0, 'Lâm Phong', 'lâm phong', false],
    ]);
    assert.deepEqual(marked(['Thấy Phong cười.', 'Rồi nói: Lâm Phong.'], ''), []);
  });
  it('takes no name from inside the one a line opens with', () => {
    assert.deepEqual(marked(['Lâm Phong Vũ cười.'], ''), []);
    assert.deepEqual(marked(['Lâm Phong Vũ cười.', 'Hôm nay Lâm Phong Vũ đi.'], ''), [
      [0, 'Lâm Phong Vũ', 'lâm phong vũ', false], [1, 'Lâm Phong Vũ', 'lâm phong vũ', false],
    ]);
  });
  it('finds a name the book gives where a sentence opens with it, only as the book writes it', () => {
    assert.deepEqual(marked(['Lâm Phong Vũ cười. Thấy vậy, Phong Vũ đi.'], '', ['Lâm Phong Vũ', 'Phong Vũ']), [
      [0, 'Lâm Phong Vũ', 'lâm phong vũ', false], [0, 'Phong Vũ', 'lâm phong vũ', false],
    ]);
    assert.deepEqual(marked(['Trời có thiên đạo.'], '', ['Thiên Đạo']), []);
  });
  it('finds nothing with nothing to find', () => {
    assert.deepEqual(findMarks(['một ngày dài.'], ''), { marks: [], persons: {} });
  });
});

describe('the names a book gives', () => {
  it('takes none from where sentences open, however often', () => {
    let text = 'Mà Lạc vũ cười. Mà Lạc vũ đi. Mà Lạc vũ nói.\nHôm nay Lâm Phong gặp Lâm Phong, rồi Lâm Phong đi.';
    assert.deepEqual(findNames(text), [{ name: 'Lâm Phong', mentions: 3 }]);
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

describe('what a person is', () => {
  let names = 'Hoàng Dung, Dung Nhi [f]\nLâm Phong [m -> f]\nQuách Tĩnh';
  it('is said on their line, and is none of their names nor changes the text', () => {
    let { lines, marks, persons } = markChapter({ content: 'Dung Nhi gặp lâm phong và Quách Tĩnh.', offset: 0 }, names);
    assert.equal(lines[0].text, 'Dung Nhi gặp Lâm Phong và Quách Tĩnh.');
    assert.deepEqual(marks.toSorted((a, z) => a.start - z.start).map(({ start, end, person }) => [lines[0].text.slice(start, end), person]), [
      ['Dung Nhi', 'hoàng dung'], ['Lâm Phong', 'lâm phong'], ['Quách Tĩnh', 'quách tĩnh'],
    ]);
    assert.deepEqual(Object.fromEntries(Object.entries(persons).map(([person, { gender }]) => [person, gender])), {
      'hoàng dung': 'f', 'lâm phong': 'm→f', 'quách tĩnh': undefined,
    });
    assert.deepEqual(listedPerson(names, 'dung nhi'), { name: 'Hoàng Dung', gender: 'f' });
    assert.equal(listedPerson(names, 'Hoàng Thường'), undefined);
  });
  it('is put on their line, or taken off it, the rest of the list as it was', () => {
    assert.equal(namesWithGender(names, 'Quách Tĩnh', 'm'), 'Hoàng Dung, Dung Nhi [f]\nLâm Phong [m -> f]\nQuách Tĩnh [m]\n');
    assert.equal(namesWithGender(names, 'Lâm Phong', 'f→m'), 'Hoàng Dung, Dung Nhi [f]\nLâm Phong [f→m]\nQuách Tĩnh\n');
    assert.equal(namesWithGender(names, 'Hoàng Dung'), 'Hoàng Dung, Dung Nhi\nLâm Phong [m -> f]\nQuách Tĩnh\n');
    assert.equal(namesWithGender(names, 'Hoàng Thường', 'm'), null);
    assert.equal(namesWith(names, { name: 'Dung nhi' }), null);
    assert.equal(namesWith(names, { name: 'Tiểu Dung', alias: 'Hoàng Dung' }), 'Hoàng Dung, Dung Nhi [f], Tiểu Dung\nLâm Phong [m -> f]\nQuách Tĩnh\n');
  });
  it('goes beside each of their names in a chapter, cut into the line', () => {
    let chapter = markChapter({ content: 'Lâm Phong cười.\nDung Nhi, xem https://x.vn của Lâm Phong.', offset: 0 }, names);
    let said = genderSaid(chapter);
    assert.deepEqual([...said.keys()], [0, 1]);
    assert.deepEqual(piecesSaying(['Lâm Phong cười.'], said.get(0)!), ['Lâm Phong', said.get(0)![0], ' cười.']);
    assert.deepEqual(piecesSaying(['Dung Nhi, xem ', { href: 'https://x.vn' }, ' của Lâm Phong.'], said.get(1)!), [
      'Dung Nhi', said.get(1)![0], ', xem ', { href: 'https://x.vn' }, ' của Lâm Phong', said.get(1)![1], '.',
    ]);
  });
});

describe('any of some names', () => {
  it('finds whole words only, the longer name first', () => {
    assert.deepEqual([...'Lan an, an Nhiên'.matchAll(anyOf(['an', 'an nhiên']))].map(match => match[0]), ['an', 'an Nhiên']);
  });
});
