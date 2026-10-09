const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { loadParser } = require('./load.js');

const { extractChapters, normalizeFileContent, readNumberWords, cleanTitle, bookRecord, Book, chapterTitle } = loadParser();

// -- helpers
const words = ['gió', 'núi', 'mưa', 'đêm', 'trăng', 'suối', 'rừng', 'đường', 'nhà', 'bến'];
// `count` paragraphs of plain story text, none of which looks like a heading
const story = (count, seed = 0) => Array.from({ length: count }, (_, k) => (
  `Nàng đi qua ${words[(k + seed) % 10]} ${words[(k * 3 + seed) % 10]} và nhớ lại chuyện cũ rất lâu trước kia ở nơi đó.`
)).join('\n\n');
const book = (...parts) => parts.flat().join('\n\n');
// every book here opens with a title page, as most do
const prepare = (text, name = 'Sách thử') => normalizeFileContent(`${name} tác giả: ai đó\n\n${text}`);
const parse = (text, name = 'Sách thử') => extractChapters(name, prepare(text, name), { name });
const titles = (chapters) => chapters.map(c => c.title);
const real = (chapters) => chapters.slice(1);   // without the title page the parser puts first

describe('numbers in words', () => {
  const read = (s) => readNumberWords(s.split(' '), 0);
  it('reads tens and units', () => {
    assert.deepEqual(read('hai mươi tư'), { value: 24, length: 3 });
    assert.deepEqual(read('mười lăm'), { value: 15, length: 2 });
    assert.equal(read('ba mươi').value, 30);
    assert.equal(read('mười').value, 10);
  });
  it('reads Sino-Vietnamese digits and tens', () => {
    assert.equal(read('tam').value, 3);
    assert.equal(read('thập nhất').value, 11);
    assert.equal(read('nhị thập tam').value, 23);
  });
  it('reads 100-199 digit by digit', () => {
    assert.equal(read('nhất lẻ loi').value, 100);
    assert.equal(read('nhất lẻ một').value, 101);
    assert.equal(read('nhất nhất linh').value, 110);
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
  const chapterText = (n) => `Chương ${n}\n\n${story(8, n)}`;
  it('a sentence that starts with a number word', () => {
    let text = book(chapterText(1), 'Một giờ sau, nàng mới biết chuyện gì đã xảy ra.', story(5), chapterText(2), 'Hai người nhìn nhau rất lâu không nói gì cả.', chapterText(3), chapterText(4));
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
    assert.ok(chapters.at(-3).content.includes('thỉnh mong chờ'));
  });
  it('a contents list in front of long chapters', () => {
    let list = [1, 2, 3, 4].map(n => `Chương ${n}: Tên ${n}`).join('\n');
    let long = Array.from({ length: 10 }, (_, k) => `Chương ${k + 1}: Tên ${k + 1}\n\n${story(40, k)}`);
    let chapters = real(parse(book(list, long)));
    assert.equal(chapters.length, 10);
    assert.ok(chapters.every(c => c.content.split('\n').length > 40));
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
    assert.equal(chapters.at(-1).title, 'Chương kết');
    assert.equal(chapters.length, 5);
  });
});

describe('parts, ranges and extras', () => {
  it('shows the parts of a chapter one by one', () => {
    let text = book([1, 2].map(n => `Chương ${n}\n\n${story(6, n)}`), ['thượng', 'trung', 'hạ'].map(p => `Chương 3: (${p})\n\n${story(6)}`), `Chương 4\n\n${story(6)}`);
    assert.deepEqual(titles(real(parse(text))), ['Chương 1', 'Chương 2', 'Chương 3 (thượng)', 'Chương 3 (trung)', 'Chương 3 (hạ)', 'Chương 4']);
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
});

describe('books', () => {
  const volume = (name, first) => [`Quyển thứ ${name}: Tên ${name}`, ...[0, 1, 2].map(k => `Chương ${first + k}\n\n${story(6, k)}`)];
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
    assert.ok(new Set(groups.map(g => g.split(' ')[0])).size == 1);
  });
  it('names the phase before the first one a heading names', () => {
    let phase = (word, first) => [`【Sách thử】 giai đoạn thứ ${word}`, ...[0, 1, 2].map(k => `Chương ${first + k}\n\n${story(6, k)}`)];
    let chapters = real(parse(book(phase('nhất', 1), phase('hai', 4))));
    assert.deepEqual([...new Set(chapters.map(c => c.group))], ['Giai đoạn 1', 'Giai đoạn 2']);
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
    assert.deepEqual(Object.keys(chapter).sort(), ['content', 'group', 'id', 'offset', 'title']);
  });
  it('stores a book without the text of its chapters', () => {
    let record = bookRecord({ id: 'a', name: 'A', description: undefined, chapters: parse(book('Chương 1', story(4), 'Chương 2', story(4))) });
    assert.ok(record.chapters.every(c => !('content' in c)));
    assert.equal(record.parser, loadParser().PARSER_VERSION);
  });
  it('is made from a file name', () => {
    let made = Book({ name: 'Tên sách (1-3 chương) (nón xanh).txt' });
    assert.equal(made.name, 'Tên sách');
    assert.equal(made.description, '(1-3 chương) (nón xanh)');
    assert.equal(made.id, 'ten-sach');
  });
});
