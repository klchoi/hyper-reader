import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractChapters, finishChapters, normalizeFileContent, readNumberWords, cleanTitle, chapterTitle } from '../src/parser.ts';
import type { Chapter } from '../src/parser.ts';
import { bookRecord, Book, PARSER_VERSION } from '../src/book.ts';

// -- helpers
const words = ['gió', 'núi', 'mưa', 'đêm', 'trăng', 'suối', 'rừng', 'đường', 'nhà', 'bến'];
// `count` paragraphs of plain story text, none of which looks like a heading
const story = (count: number, seed = 0) => Array.from({ length: count }, (_, k) => (
  `Nàng đi qua ${words[(k + seed) % 10]} ${words[(k * 3 + seed) % 10]} và nhớ lại chuyện cũ rất lâu trước kia ở nơi đó.`
)).join('\n\n');
const book = (...parts: (string | string[])[]) => parts.flat().join('\n\n');
// every book here opens with a title page, as most do
const prepare = (text: string, name = 'Sách thử') => normalizeFileContent(`${name} tác giả: ai đó\n\n${text}`);
const parse = (text: string, name = 'Sách thử') => extractChapters(name, prepare(text, name), { name });
const titles = (chapters: Chapter[]) => chapters.map(c => c.title);
const real = (chapters: Chapter[]) => chapters.slice(1);   // without the title page the parser puts first

describe('numbers in words', () => {
  const read = (s: string) => readNumberWords(s.split(' '), 0);
  it('reads tens and units', () => {
    assert.deepEqual(read('hai mươi tư'), { value: 24, length: 3 });
    assert.deepEqual(read('mười lăm'), { value: 15, length: 2 });
    assert.equal(read('ba mươi')?.value, 30);
    assert.equal(read('mười')?.value, 10);
  });
  it('reads Sino-Vietnamese digits and tens', () => {
    assert.equal(read('tam')?.value, 3);
    assert.equal(read('thập nhất')?.value, 11);
    assert.equal(read('nhị thập tam')?.value, 23);
  });
  it('reads 100-199 digit by digit', () => {
    assert.equal(read('nhất lẻ loi')?.value, 100);
    assert.equal(read('nhất lẻ một')?.value, 101);
    assert.equal(read('nhất nhất linh')?.value, 110);
  });
  it('leaves a plain word alone', () => {
    assert.equal(read('giờ'), null);
  });
});

describe('titles', () => {
  it('drops what stands in front, keeps a tag that closes', () => {
    assert.equal(cleanTitle(': Lão Trần tính toán 【 tu 】'), 'Lão Trần tính toán 【 tu 】');
    assert.equal(cleanTitle(' - Hắc hưu!!"'), 'Hắc hưu!!');
  });
  it('is composed in one place', () => {
    assert.equal(chapterTitle({ number: '5', title: 'đêm dài' }, 0), 'Chương 5: Đêm dài');
    assert.equal(chapterTitle({ number: '27', part: { text: 'thượng' } }, 0), 'Chương 27 (thượng)');
    assert.equal(chapterTitle({ number: 'kết' }, 0), 'Chương kết');
    assert.equal(chapterTitle({ type: 'Phiên ngoại', number: '3', title: 'x' }, 0), 'Phiên ngoại 3: X');
    assert.equal(chapterTitle({}, 4), 'Chương 5');
  });
});

describe('numbered chapters', () => {
  const text = book('Sách thử tác giả: ai đó', [1, 2, 3, 4, 5].map(n => `Chương ${n}: Tiêu đề ${'abcde'[n - 1]}\n\n${story(8, n)}`));
  const chapters = parse(text);
  it('finds every chapter, with the title page first', () => {
    assert.deepEqual(titles(chapters), ['Sách thử', 'Chương 1: Tiêu đề a', 'Chương 2: Tiêu đề b', 'Chương 3: Tiêu đề c', 'Chương 4: Tiêu đề d', 'Chương 5: Tiêu đề e']);
  });
  it('cuts the text at the headings, losing nothing', () => {
    let normalized = prepare(text);
    assert.equal(chapters[0].offset, 0);
    chapters.forEach((c, i) => {
      let end = chapters[i + 1]?.offset ?? normalized.length;
      assert.equal(c.content, normalized.slice(c.offset, end).trim());
    });
    assert.ok(chapters[1].content.startsWith('Chương 1'));
  });
  it('gives each chapter an id of its own', () => {
    assert.equal(new Set(chapters.map(c => c.id)).size, chapters.length);
  });
});

describe('what is not a chapter', () => {
  const chapterText = (n: number) => `Chương ${n}\n\n${story(8, n)}`;
  it('a sentence that starts with a number word', () => {
    let text = book(chapterText(1), 'Một giờ sau, nàng mới biết chuyện gì đã xảy ra.', story(5), chapterText(2), 'Hai người nhìn nhau rất lâu không nói gì cả.', chapterText(3), chapterText(4));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 4']);
  });
  it('a long paragraph that begins with its chapter, set apart by nothing', () => {
    // as likely a note on chapter 3 as chapter 3 itself: a book of these is read in pages
    let note = `Chương 3: vừa ra, ${story(8).replaceAll('\n\n', ' ')}`;
    let text = book(chapterText(1), chapterText(2), story(3), note, story(3), chapterText(3), chapterText(4));
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 4']);
    assert.ok(chapters[1].content.includes('vừa ra'));
  });
  it('a long paragraph that begins with a number', () => {
    let long = `3 ${story(8).replaceAll('\n\n', ' ')}`;
    let text = book(chapterText(1), long, story(3), chapterText(2), `Năm ${long}`, chapterText(3), chapterText(4));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 4']);
  });
  it('a fraction or a door code', () => {
    let text = book(chapterText(1), '【0.05】', story(4), '"0... 2... 1... 8 "', story(4), chapterText(2), chapterText(3), chapterText(4));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 4']);
  });
  it('a note that points at the next chapter', () => {
    let text = book(chapterText(73), chapterText(74), chapterText(75), '(Chương 75: Xong, thỉnh mong chờ Chương 76: 《 hỉ thêm thiên kim 》.)', chapterText(76), chapterText(77));
    let chapters = parse(text);
    assert.deepEqual(titles(chapters).slice(-3), ['Chương 75', 'Chương 76', 'Chương 77']);
    assert.ok(chapters.at(-3)?.content.includes('thỉnh mong chờ'));
  });
  it('a contents list in front of long chapters', () => {
    let list = [1, 2, 3, 4].map(n => `Chương ${n}: Tên ${n}`).join('\n');
    let long = Array.from({ length: 10 }, (_, k) => `Chương ${k + 1}: Tên ${k + 1}\n\n${story(40, k)}`);
    let chapters = real(parse(book(list, long)));
    assert.equal(chapters.length, 10);
    assert.ok(chapters.every(c => c.content.split('\n').length > 40));
  });
  it('a contents list whose entries carry a few lines each', () => {
    let list = [1, 2, 3, 4].map(n => `Chương ${n}: Tên ${n}\n\n${story(3, n)}`);
    let long = Array.from({ length: 10 }, (_, k) => `Chương ${k + 1}: Tên ${k + 1}\n\n${story(40, k)}`);
    let chapters = parse(book(list, long));
    assert.equal(real(chapters).length, 10);
    assert.ok(chapters[0].content.includes('Chương 4: Tên 4'));
  });
  it('a story that mentions a chapter in a sentence', () => {
    let text = book(chapterText(1), 'Nàng đọc lại, đến Chương 9 thì dừng lại vì mệt.', story(3), chapterText(2), chapterText(3), chapterText(4));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 4']);
  });
});

describe('the last chapter', () => {
  it('is one chapter when it is said twice', () => {
    let text = book([1, 2, 3].map(n => `Chương ${n}: Cũ ${'abc'[n - 1]}\n\n${story(6, n)}`), 'Chương 4: Chương kết', '【chương kết】', story(6));
    let chapters = parse(text);
    assert.equal(chapters.at(-1)?.title, 'Chương kết');
    assert.equal(chapters.length, 5);
  });
});

describe('parts, ranges and extras', () => {
  const parts = (chapters: Chapter[]) => chapters.map(c => c.part && `${c.part.of} > ${c.part.text}`);
  it('shows the parts of a chapter one by one, under the chapter named once', () => {
    let text = book([1, 2].map(n => `Chương ${n}\n\n${story(6, n)}`), ['thượng', 'trung', 'hạ'].map(p => `Chương 3: (${p})\n\n${story(6)}`), `Chương 4\n\n${story(6)}`);
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters), ['Chương 1', 'Chương 2', 'Chương 3 (thượng)', 'Chương 3 (trung)', 'Chương 3 (hạ)', 'Chương 4']);
    assert.deepEqual(parts(chapters), [undefined, undefined, 'Chương 3 > (thượng)', 'Chương 3 > (trung)', 'Chương 3 > (hạ)', undefined]);
  });
  it('takes parts as many as the chapters they run over for those chapters, whatever their titles say', () => {
    let text = book([`Chương 8: Quà\n\n${story(6)}`, `Chương 9: Yoga (thượng)\n\n${story(6, 1)}`, `Chương 10: Yoga (hạ)\n\n${story(6, 2)}`, `Chương 11: Học bù\n\n${story(6, 3)}`]);
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters), ['Chương 8: Quà', 'Chương 9: Yoga (thượng)', 'Chương 10: Yoga (hạ)', 'Chương 11: Học bù']);
    assert.deepEqual(parts(chapters), [undefined, undefined, undefined, undefined]);
    let numbered = book(['nhất', 'nhị', 'tam'].map((p, k) => `Chương ${5 + k}: Dạ tập (${p})\n\n${story(6, k)}`), `Chương 8: Sáng\n\n${story(6)}`);
    assert.deepEqual(parts(real(parse(numbered))), [undefined, undefined, undefined, undefined]);
    let first = book([`Chương 88: Na Trát\n\n${story(6)}`, `Chương 89: Na Trát (2)\n\n${story(6, 1)}`, `Chương 90: Na Trát (3)\n\n${story(6, 2)}`, `Chương 91: Đi\n\n${story(6, 3)}`]);
    assert.deepEqual(parts(real(parse(first))), [undefined, undefined, undefined, undefined]);
  });
  it('names parts that are not as many as the chapters they run over once, over its range', () => {
    let skipping = book([5, 7, 8].map((n, k) => `Chương ${n}: Dạ tập (${k + 1})\n\n${story(6, k)}`), `Chương 9: Sáng\n\n${story(6)}`);
    assert.deepEqual(parts(real(parse(skipping))), ['Chương 5-8: Dạ tập > (1/3)', 'Chương 5-8: Dạ tập > (2/3)', 'Chương 5-8: Dạ tập > (3/3)', undefined]);
    let fewer = book([5, 7].map((n, k) => `Chương ${n}: Dạ tập (${['thượng', 'hạ'][k]})\n\n${story(6, k)}`), `Chương 8: Sáng\n\n${story(6)}`);
    assert.deepEqual(parts(real(parse(fewer))), ['Chương 5-7: Dạ tập > (thượng)', 'Chương 5-7: Dạ tập > (hạ)', undefined]);
  });
  it('takes a chapter with the title of the parts after it for the first of them', () => {
    let text = book([`Chương 12: Trước\n\n${story(6)}`, `Chương 13: Yoga\n\n${story(6, 1)}`, `Chương 13: Yoga (trung)\n\n${story(6, 2)}`, `Chương 13: Yoga (hạ)\n\n${story(6, 3)}`, `Chương 14: Đi\n\n${story(6, 4)}`]);
    assert.deepEqual(parts(real(parse(text))), [undefined, 'Chương 13: Yoga > (thượng)', 'Chương 13: Yoga > (trung)', 'Chương 13: Yoga > (hạ)', undefined]);
  });
  it('begins the first part with the heading that names the parts', () => {
    let text = book(`Chương 12: Trước\n\n${story(6)}`, 'Thứ 13 chương tam đối', ['thượng', 'trung', 'hạ'].map(p => `Chương 13: (${p})\n\n${story(6)}`), `Chương 14: Sau\n\n${story(6)}`);
    let chapters = real(parse(text));
    assert.deepEqual(parts(chapters), [undefined, 'Chương 13: Tam đối > (thượng)', 'Chương 13: Tam đối > (trung)', 'Chương 13: Tam đối > (hạ)', undefined]);
    assert.deepEqual(titles(chapters).slice(1, 3), ['Chương 13: Tam đối (thượng)', 'Chương 13: Tam đối (trung)']);
    assert.ok(chapters[1].content.startsWith('Thứ 13 chương tam đối'));
  });
  it('keeps a part the book repeats among the others, and takes one repeated alone for none', () => {
    let drafts = (headings: string[][]) => headings.map(([number, title], k) => ({ offset: k * 10, heading: { number, title, text: title } }));
    let repeated = drafts([['119', 'Hành động (1)'], ['119', 'Hành động (1)'], ['119', 'Hành động (2)']]);
    assert.deepEqual(parts(finishChapters(repeated, story(3))), ['Chương 119: Hành động > (1/2)', 'Chương 119: Hành động > (1/2)', 'Chương 119: Hành động > (2/2)']);
    let over = drafts([['119', 'Hành động (1)'], ['119', 'Hành động (1)'], ['120', 'Hành động (2)']]);
    assert.deepEqual(parts(finishChapters(over, story(3))), ['Chương 119-120: Hành động > (1/2)', 'Chương 119-120: Hành động > (1/2)', 'Chương 119-120: Hành động > (2/2)']);
    let alone = drafts([['119', 'Hành động (1)'], ['119', 'Hành động (1)']]);
    assert.deepEqual(parts(finishChapters(alone, story(3))), [undefined, undefined]);
  });
  it('starts the parts over with the next chapter, and takes a note in brackets for none', () => {
    let text = book(['27', '28'].flatMap(n => ['thượng', 'hạ'].map(p => `Chương ${n}: (${p})\n\n${story(6)}`)), `Chương 29: Thu hoạch\n\n${story(6)}`, `Chương 30: Thu hoạch (tu)\n\n${story(6)}`);
    assert.deepEqual(parts(real(parse(text))), ['Chương 27 > (thượng)', 'Chương 27 > (hạ)', 'Chương 28 > (thượng)', 'Chương 28 > (hạ)', undefined, undefined]);
  });
  it('reads one heading over a run of chapters', () => {
    let text = book(['Thứ 1-6 chương', 'Thứ 7-10 chương', 'Thứ 11-14 chương'].map((h, k) => `${h}\n\n${story(8, k)}`));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1-6', 'Chương 7-10', 'Chương 11-14']);
  });
  it('reads phiên ngoại with a bracketed number', () => {
    let text = book([1, 2, 3].map(n => `Chương ${n}\n\n${story(6, n)}`), [1, 2, 3].map(n => `Phiên ngoại: 【${n}】 chuyện ${n}\n\n${story(6, n)}`));
    assert.deepEqual(titles(real(parse(text))).slice(3), ['Phiên ngoại 1: Chuyện 1', 'Phiên ngoại 2: Chuyện 2', 'Phiên ngoại 3: Chuyện 3']);
  });
  it('reads a Sino-Vietnamese ordinal and a comma', () => {
    let text = book(['Nhất', 'Nhị', 'Tam', 'Tứ'].map((o, k) => `${o}, tiêu đề ${'abcd'[k]}\n\n${story(6, k)}`));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1: Tiêu đề a', 'Chương 2: Tiêu đề b', 'Chương 3: Tiêu đề c', 'Chương 4: Tiêu đề d']);
  });
  it('lets `Chính văn` label a heading without being in its title', () => {
    let text = book([1, 2, 3].map(n => `Chính văn thứ ${n} chương cảnh ${'abc'[n - 1]}\n\n${story(6, n)}`));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1: Cảnh a', 'Chương 2: Cảnh b', 'Chương 3: Cảnh c']);
  });
  it('lets the day a chapter was posted stand in front of its heading', () => {
    let text = book([1, 2, 3, 4].map(n => `2018-11-${10 + n}【Chương ${n}: Cảnh ${'abcd'[n - 1]}\n\n${story(6, n)}`));
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters), ['Chương 1: Cảnh a', 'Chương 2: Cảnh b', 'Chương 3: Cảnh c', 'Chương 4: Cảnh d']);
    assert.ok(chapters[1].content.startsWith('2018-11-12【Chương 2'));
  });
  it('reads the heading set apart in front of a chapter posted as one paragraph, and gives it no title of its text', () => {
    // a whole chapter on one line, its heading in front: the line is far too long for a heading
    let paragraph = (n: number) => story(8, n).replaceAll('\n\n', ' ');
    let text = book(`Chương 1: Cảnh a\n\n${story(6, 1)}`, `【Chương 2: ${paragraph(2)}`, `2018-11-18【Chương 3: ${paragraph(3)}`, `Chương 4: Cảnh d\n\n${story(6, 4)}`);
    assert.ok(paragraph(2).length > 400);
    assert.deepEqual(titles(real(parse(text))), ['Chương 1: Cảnh a', 'Chương 2', 'Chương 3', 'Chương 4: Cảnh d']);
  });
  it('reads a bracketed number run on behind a paragraph, in a book of bracketed numbers', () => {
    // (4) at the end of the paragraph before it, (6) between two paragraphs on one line
    let text = book(
      [1, 2, 3].map(n => `(${n})\n\n${story(8, n)}`),
      `Nàng đi ngủ sớm một chút.       (4)\n\n${story(8, 4)}`,
      `(5)\n\n${story(8, 5)}`,
      `Nàng cầm súng lên. (6) Nàng đi qua núi rừng và nhớ chuyện cũ.\n\n${story(8, 6)}`,
      [7, 8].map(n => `(${n})\n\n${story(8, n)}`),
    );
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters), [1, 2, 3, 4, 5, 6, 7, 8].map(n => `Chương ${n}`));
    assert.ok(chapters[5].content.startsWith('(6) Nàng đi qua'));
  });
  it('takes a bracketed number behind a paragraph for a note where headings are not those', () => {
    let text = book(`Một cái tay đỡ lấy nàng.\n\n${story(8, 1)}`, `Hai người ôm nhau. (2)\n\n${story(8, 2)}`, `(3) Ba ngày sau\n\n${story(8, 3)}`, `Nàng đi. (4) Rồi về.\n\n${story(8, 4)}`);
    assert.ok(parse(text).every(c => !/Chương [124]$/.test(c.title)));
  });
  it('goes on past the chapters a book leaves out', () => {
    let numbers = [1, 3, 4, 5, 6, 7, 8, 12, 13, 14, 15, 16, 17];
    let text = book(numbers.map(n => `(${n})\n\n${story(10, n)}`));
    assert.deepEqual(titles(real(parse(text))), numbers.map(n => `Chương ${n}`));
  });
  it('reads a title that says how long its chapter is, and a title that begins with từ', () => {
    let text = book(`086 Nhị thiếu gia\n\n${story(8, 1)}`, `087 vạn chữ đại càng chúc mừng!\n\n${story(8, 2)}`, `088 Ba người\n\n${story(8, 3)}`, `Chương 89 từ sau trở về\n\n${story(8, 4)}`, `Chương 90: Cuối\n\n${story(8, 5)}`);
    assert.deepEqual(real(parse(text)).map(c => c.title.split(':')[0]), ['Chương 86', 'Chương 87', 'Chương 88', 'Chương 89', 'Chương 90']);
  });
  it('takes how long a chapter is for no number of it', () => {
    let text = book([1, 2, 3, 4].map(n => `Chương ${n}:\n\n${n}.${n + 1} vạn chữ\n\n${story(6, n)}${n === 2 ? '\n\nMột cái mười lăm tuổi con lai.\n\nTam đại cùng đường, bà mẹ con.' : ''}`));
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 4']);
  });
});

describe('headings of other shapes', () => {
  it('reads a series whose headings begin alike and carry no number', () => {
    let text = book(Array.from({ length: 10 }, (_, k) => `Quy tắc quái đàm — cảnh ${'abcdefghij'[k]}\n\n${story(8, k)}`));
    let chapters = real(parse(text, 'Quy tắc quái đàm'));
    assert.equal(chapters.length, 10);
    assert.deepEqual(titles(chapters).slice(0, 2), ['Chương 1: Cảnh a', 'Chương 2: Cảnh b']);
  });
  it('does not take a name and a dash in dialogue for a series', () => {
    let lines = Array.from({ length: 12 }, (_, k) => `Tô Bạch — ${words[k % 10]} đã tới, ngươi mau ra mà xem.\n\n${story(5, k)}`);
    let chapters = real(parse(book(lines), 'Một cuốn sách khác'));
    assert.ok(chapters.length < 3);
  });
  it('groups the parts of a section under its heading', () => {
    let text = book([[2, 1], [2, 2], [2, 3], [3, 1], [3, 2], [3, 3]].map(([c, h], k) => `Chương ${c}: Phần ${c} | thứ ${h} hồi cảnh ${k}\n\n${story(8, k)}`));
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters).slice(0, 4), ['Hồi 1: Cảnh 0', 'Hồi 2: Cảnh 1', 'Hồi 3: Cảnh 2', 'Hồi 1: Cảnh 3']);
    assert.deepEqual([...new Set(chapters.map(c => c.group))], ['Chương 2: Phần 2', 'Chương 3: Phần 3']);
  });
  it('shows the parts a chapter is written in by number', () => {
    let text = book(['nhất', 'nhị', 'tam', 'tứ', 'ngũ'].map((p, k) => `Chương 44: (${p})\n\n${story(8, k)}`));
    let chapters = real(parse(text));
    assert.deepEqual(titles(chapters), ['Chương 44 (nhất)', 'Chương 44 (nhị)', 'Chương 44 (tam)', 'Chương 44 (tứ)', 'Chương 44 (ngũ)']);
    assert.deepEqual(chapters.map(c => c.part?.text), ['(1/5)', '(2/5)', '(3/5)', '(4/5)', '(5/5)']);
  });
  it('keeps a piece set between two chapters outside their numbers', () => {
    let text = book([`Chương 1\n\n${story(8)}`, `Chương 2\n\n${story(8)}`, `Thứ 0 chương phiên ngoại: Cảnh riêng\n\n${story(8)}`, `Chương 3\n\n${story(8)}`, `Chương 4\n\n${story(8)}`]);
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Phiên ngoại: Cảnh riêng', 'Chương 3', 'Chương 4']);
  });
  it('keeps a piece in front of a book\'s first chapter', () => {
    let text = book(['Quyển thứ nhất', `Chương 1\n\n${story(8)}`, `Chương 2\n\n${story(8)}`, 'Quyển thứ hai', `Thứ 0 chương tự\n\n${story(8)}`, `Chương 1\n\n${story(8)}`, `Chương 2\n\n${story(8)}`]);
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Tự', 'Chương 1', 'Chương 2']);
  });
  it('finds a heading that follows its book words on the same line', () => {
    let text = book([1, 2, 3].map(n => `Chương ${n}\n\n${story(8, n)}`), `Quyển thứ ba con rối thánh nữ thiên Chương 4: Thất thân cảnh\n\n${story(8)}`, `Chương 5\n\n${story(8)}`);
    assert.equal(real(parse(text))[3].title, 'Chương 4: Thất thân cảnh');
  });
});

describe('books', () => {
  const volume = (name: string, first: number) => [`Quyển thứ ${name}: Tên ${name}`, ...[0, 1, 2].map(k => `Chương ${first + k}\n\n${story(6, k)}`)];
  it('groups chapters under the book that names itself', () => {
    let chapters = real(parse(book(volume('nhất', 1), volume('hai', 4))));
    assert.deepEqual(chapters.map(c => c.group), ['Quyển 1', 'Quyển 1', 'Quyển 1', 'Quyển 2', 'Quyển 2', 'Quyển 2']);
  });
  it('lets the numbers start over in a new book', () => {
    let chapters = real(parse(book(volume('nhất', 1), volume('hai', 1))));
    assert.deepEqual(titles(chapters), ['Chương 1', 'Chương 2', 'Chương 3', 'Chương 1', 'Chương 2', 'Chương 3']);
    assert.deepEqual([...new Set(chapters.map(c => c.group))], ['Quyển 1', 'Quyển 2']);
  });
  it('labels a book of another kind by its own word', () => {
    let second = ['Bộ 02', ...[1, 2, 3].map(n => `Chương ${n}\n\n${story(6, n)}`)];
    let chapters = real(parse(book(volume('nhất', 1), volume('hai', 4), second)));
    assert.deepEqual([...new Set(chapters.map(c => c.group))], ['Quyển 1', 'Quyển 2', 'Bộ 2']);
    assert.deepEqual(titles(chapters).slice(-3), ['Chương 1', 'Chương 2', 'Chương 3']);
  });
  it('calls the books one thing when the headings say it two ways', () => {
    let mixed = [volume('nhất', 1), ['Cuốn 2: Tên hai', ...[4, 5, 6].map(n => `Chương ${n}\n\n${story(6, n)}`)], ['Quyển 3: Tên ba', ...[7, 8, 9].map(n => `Chương ${n}\n\n${story(6, n)}`)]];
    let groups = [...new Set(real(parse(book(...mixed))).map(c => c.group))];
    assert.equal(groups.length, 3);
    assert.ok(new Set(groups.map(g => g?.split(' ')[0])).size == 1);
  });
  it('names the phase before the first one a heading names', () => {
    let phase = (word: string, first: number) => [`【Sách thử】 giai đoạn thứ ${word}`, ...[0, 1, 2].map(k => `Chương ${first + k}\n\n${story(6, k)}`)];
    let chapters = real(parse(book(phase('nhất', 1), phase('hai', 4))));
    assert.deepEqual([...new Set(chapters.map(c => c.group))], ['Giai đoạn 1', 'Giai đoạn 2']);
  });
  it('keeps the sections in front of the first book, which are no contents list', () => {
    let front = [`Chương 1: Nhân vật\n\n${story(3)}`, `Chương 2: Thế lực\n\n${story(12)}`];
    let first = ['Quyển thứ nhất: Tên nhất', ...[1, 2, 3, 4, 5].map(n => `Chương ${n}\n\n${story(40, n)}`)];
    let chapters = real(parse(book(front, first)));
    assert.deepEqual(titles(chapters).slice(0, 3), ['Chương 1: Nhân vật', 'Chương 2: Thế lực', 'Chương 1']);
  });
  it('reads the book a chapter names in brackets after it', () => {
    let part = (b: number, name: string) => [`Thứ 1 chương (bộ 0${b}) chi ${name}\n\n${story(6, b)}`, ...[2, 3].map(n => `Thứ ${n} chương\n\n${story(6, n)}`)];
    let chapters = real(parse(book(part(1, 'kỳ nghỉ'), part(2, 'du thuyền'))));
    assert.deepEqual(chapters.map(c => c.group), ['Bộ 1', 'Bộ 1', 'Bộ 1', 'Bộ 2', 'Bộ 2', 'Bộ 2']);
    assert.deepEqual(titles(chapters).slice(0, 4), ['Chương 1: Kỳ nghỉ', 'Chương 2', 'Chương 3', 'Chương 1: Du thuyền']);
  });
  it('groups the books a file holds under the names their title lines give', () => {
    let titled = (title: string) => [`Tên sách: ${title}`, 'Tác giả: ai đó', ...[1, 2, 3].map(n => `Thứ ${n} chương\n\n${story(6, n)}`)];
    let chapters = real(parse(book(titled('Ngoại truyện: Ba cô gái'), titled('Tiền truyện: Vịnh Văn'))));
    assert.deepEqual([...new Set(chapters.map(c => c.group))], ['Ngoại truyện: Ba cô gái', 'Tiền truyện: Vịnh Văn']);
    assert.ok(chapters[3].content.startsWith('Tên sách: Tiền truyện'));
  });
  it('takes a lone title line for the title page\'s own', () => {
    let text = book('Tên sách: Sách thử', [1, 2, 3].map(n => `Thứ ${n} chương\n\n${story(6, n)}`));
    assert.ok(parse(text).every(c => !c.group));
  });
  it('does not take a sentence about a book for one', () => {
    let text = book([1, 2, 3, 4].map(n => `Chương ${n}\n\n${story(6, n)}`), 'Hai bộ quần áo nằm trên giường rất đẹp mắt.');
    assert.ok(parse(text).every(c => !c.group));
  });
});

describe('a book with no headings', () => {
  it('is read in pages', () => {
    let chapters = parse(story(200));
    assert.ok(chapters.length >= 3);
    assert.ok(chapters.every(c => /^Chương \d+$/.test(c.title)));
  });
});

describe('the model', () => {
  it('is plain data', () => {
    let [chapter] = parse(book('Chương 1\n\nx', story(4), 'Chương 2\n\ny', story(4)));
    assert.deepEqual(Object.keys(chapter).sort(), ['content', 'group', 'id', 'offset', 'part', 'title']);
  });
  it('stores a book without the text of its chapters', () => {
    let record = bookRecord({ id: 'a', name: 'A', description: undefined, chapters: parse(book('Chương 1', story(4), 'Chương 2', story(4))) });
    assert.ok(record.chapters.every(c => !('content' in c)));
    assert.equal(record.parser, PARSER_VERSION);
  });
  it('is made from a file name', () => {
    let made = Book({ name: 'Tên sách (1-3 chương) (nón xanh).txt' });
    assert.equal(made.name, 'Tên sách');
    assert.equal(made.description, '(1-3 chương) (nón xanh)');
    assert.equal(made.id, 'ten-sach');
  });
});
