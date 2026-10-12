// The library as it is browsed (src/catalog.ts): what a file's name says the book is, and the
// books found by what is asked, on names as the books are named.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeFile, entryOf, findBooks, queryOf, queryString, topTags } from '../src/catalog.ts';
import type { Progress, Query } from '../src/catalog.ts';

describe('what a file says of its book', () => {
  it('reads the title, the tags in brackets, and the length as a note', () => {
    assert.deepEqual(describeFile('Đổi yêu gia tộc (1-416 chương) (np loạn chiến, bách hợp, mẹ con).txt'), {
      title: 'Đổi yêu gia tộc', tags: ['np loạn chiến', 'bách hợp', 'mẹ con'], note: '1-416 chương', folder: undefined,
    });
    assert.deepEqual(describeFile('Sinh viên trao đổi bạn gái (1-3 bộ 116 chương + 4 phiên ngoại) (nón xanh loạn chiến).txt').note, '1-3 bộ 116 chương + 4 phiên ngoại');
    assert.equal(describeFile('Tù nhân trở về (1-44.9 chương).txt').note, '1-44.9 chương');
  });
  it('says a book is finished wherever its name does', () => {
    assert.deepEqual(describeFile('Của ta võ lâm (1-20 chương kết thúc) (loạn chiến, nón xanh).txt').tags, ['loạn chiến', 'nón xanh', 'kết thúc']);
    assert.deepEqual(describeFile('Tiên tử (1-115 chương) (kết thúc, hậu cung).txt').tags, ['hậu cung', 'kết thúc']);
    let ranged = describeFile('Phu nhân (1-71 kết thúc) (cao H).txt');
    assert.deepEqual([ranged.tags, ranged.note], [['cao H', 'kết thúc'], '1-71 kết thúc']);
  });
  it('finds the title after tags that come first, and a note after a tilde', () => {
    let leading = describeFile('(si hán-hentai) người phóng khoáng lạc quan (1-25 chương + ngoại truyện).txt');
    assert.deepEqual([leading.title, leading.tags], ['Người phóng khoáng lạc quan', ['si hán-hentai']]);
    let tilde = describeFile('Hogwarts duy nhất ngoạn gia (1-116 chương) ~ Edit name.txt');
    assert.deepEqual([tilde.title, tilde.note], ['Hogwarts duy nhất ngoạn gia', '1-116 chương · Edit name']);
  });
  it('keeps a title made only of brackets, and says the folder a book is in', () => {
    assert.equal(describeFile('(1-3 chương).txt').title, '(1-3 chương)');
    assert.equal(describeFile('_Bộ sưu tập của lão Hề/con/Một truyện.txt').folder, 'Bộ sưu tập của lão Hề');
  });
});

describe('the books asked for', () => {
  let day = (date: string) => Date.parse(date);
  let entries = [
    { id: 'a', path: 'Hoàng Dung truyện (1-50 chương) (hậu cung, NTL).txt', size: 2e6, chapters: 50, date: day('2026-01-02') },
    { id: 'b', path: 'Tiên tử tu hành (1-300 chương kết thúc) (hậu cung).txt', size: 8e6, chapters: 300, date: day('2026-03-01') },
    { id: 'c', path: '_Tuyển tập/Dung nhi (1-12 chương) (ntl).txt', size: 4e5, chapters: 12, date: day('2024-02-11') },
    { id: 'd', path: 'Một ngày dài.txt', size: 3e7, chapters: 1500, date: day('2025-07-07') },
  ].map(book => entryOf({ ...book, deletable: false }));
  let progress: Record<string, Progress> = { c: { chapterIndex: 3, chapterCount: 12, updatedAt: '2026-10-01T00:00:00Z' }, d: { updatedAt: '2026-10-10T00:00:00Z' } };
  let ids = (query: Query) => findBooks(entries, progress, query).books.map(book => book.id);

  it('finds the words of a title, a tag or a folder, in any order and without accents', () => {
    assert.deepEqual(ids({ q: 'dung', sort: 'title' }), ['c', 'a']);
    assert.deepEqual(ids({ q: 'truyen hoang' }), ['a']);
    assert.deepEqual(ids({ q: 'tuyen tap' }), ['c']);
    assert.deepEqual(ids({ q: 'ntl', sort: 'latest' }), ['a', 'c']);
  });
  it('puts first the titles that begin with what was typed, then those that say it', () => {
    assert.deepEqual(ids({ q: 'dung' }), ['c', 'a']);
    assert.deepEqual(ids({ q: 'hoang dung' }), ['a']);
    // (in a title, before in a folder)
    assert.deepEqual(ids({ q: 'tu' }), ['b', 'c']);
  });
  it('holds a book to every tag asked, and to a size and a length', () => {
    assert.deepEqual(ids({ tags: ['Hậu Cung'] }), ['b', 'a']);
    assert.deepEqual(ids({ tags: ['hậu cung', 'kết thúc'] }), ['b']);
    assert.deepEqual(ids({ size: [1e6, 1e7] }), ['b', 'a']);
    assert.deepEqual(ids({ chapters: [1001, null] }), ['d']);
    assert.deepEqual(ids({ chapters: [null, 49] }), ['c']);
  });
  it('sorts by the file, the reading, the title, the size or the length', () => {
    assert.deepEqual(ids({}), ['b', 'a', 'd', 'c']);
    assert.deepEqual(ids({ sort: 'read' }), ['d', 'c']);
    assert.deepEqual(ids({ sort: 'title' }), ['c', 'a', 'd', 'b']);
    assert.deepEqual(ids({ sort: 'size', order: 'asc' }), ['c', 'a', 'b', 'd']);
    assert.deepEqual(ids({ sort: 'chapters' }), ['d', 'b', 'a', 'c']);
  });
  it('gives a page of what is found, with where each book was left', () => {
    let page = findBooks(entries, progress, { sort: 'title', offset: 1, limit: 2 });
    assert.deepEqual([page.total, page.offset, page.books.map(book => book.id)], [4, 1, ['a', 'd']]);
    assert.deepEqual(findBooks(entries, progress, { q: 'dung nhi' }).books[0].read, progress.c);
    assert.equal('words' in page.books[0], false);
  });
  it('shuffles the same way for the same seed, page after page', () => {
    let order = (seed: number) => ids({ sort: 'random', seed });
    assert.deepEqual(order(7), order(7));
    assert.deepEqual([...ids({ sort: 'random', seed: 7, limit: 2 }), ...ids({ sort: 'random', seed: 7, offset: 2, limit: 2 })], order(7));
    assert.ok([1, 2, 3, 4, 5, 6].some(seed => order(seed).join() !== order(7).join()));
  });
  it('counts the tags, each as most books write it', () => {
    assert.deepEqual(topTags(entries, 3), [{ tag: 'hậu cung', count: 2 }, { tag: 'NTL', count: 2 }, { tag: 'kết thúc', count: 1 }]);
    assert.deepEqual(topTags(entries, 1), [{ tag: 'hậu cung', count: 2 }]);
  });
});

describe('a query in a url', () => {
  it('comes back as it was asked', () => {
    let query: Query = { q: 'hoàng dung', tags: ['hậu cung', 'NTL'], size: [1000000, null], chapters: [null, 200], sort: 'random', order: 'asc', seed: 42, offset: 30, limit: 30 };
    assert.deepEqual(queryOf(new URLSearchParams(queryString(query))), query);
    assert.deepEqual(queryOf(new URLSearchParams('sort=nonsense&size=abc&limit=x')), { q: undefined, tags: [], size: undefined, chapters: undefined, sort: undefined, order: undefined, seed: undefined, offset: undefined, limit: undefined });
  });
});
