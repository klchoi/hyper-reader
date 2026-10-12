// The chapter parser. It touches nothing of the page and nothing of node, so it runs anywhere:
// in the page and in its worker (reading.ts, parser-worker.ts), and in node for the tests, the
// tools and the server.

export function normalizeFileContent(source: string) {
  let text = source.normalize();
  text = text.replace(/[\r\n]+/g, '\n');
  text = text.replace(/\t+/g, '\n');
  text = text.replace(/(?<=\S) {2,}(?=\p{Lu})/gu, '\n');
  text = text.replace(/(.+)/g, (s) => s.trim());
  text = text.replace(/^'([^']+)'$/gm, '"$1"');
  text = text.replace(/(\d)\s*(\.)\s*(\d)/gm, '$1$2$3');
  text = text.replace(/\s+([.,;:?!\]】)])/gm, '$1');
  text = text.replace(/([([【])\s+/gm, '$1');
  text = text.replace(/([:—]{2,})/gm, c => c.slice(0, 1));
  text = text.replace(/(:)[^\s\w]+\s*/gm, '$1 ');
  text = text.replace(/^\s*"\s+|\s+"\s*$/gm, '"');
  //"QQ Group 712797052"
  text = text.replace(/\s?"?QQ Group \d+"?/gu, '');
  //tìm sách a "Cuộc đời này không phụ diên đuôi tình" cá nhân cải biên
  text = text.replaceAll('  tìm sách a "Cuộc đời này không phụ diên đuôi tình" cá nhân cải biên', '');
  text = text.replace(/\b(?<protocol>https?:)(?:\/\/)? (?<path>(?:\w+)(?:\. \w+)+(?:\/(?:(?:\. )?[\w/])+)?)/gm, (...args) => {
    let { protocol, path }: { protocol?: string; path: string } = args.pop();
    path = path.replace(/\s/g, '');
    if (protocol) return `${protocol}//${path}`;
    return path;
  });
  text = text.replaceAll('cha mẹ vợ', 'mẹ vợ');
  return text;
}

// ---- chapters -----------------------------------------------------------------------
// A chapter, as the rest of the app knows it:
//   { id, title, offset, group, part, content }
// where it starts in the text, what the list calls it, the group (a book, a section)
// the list puts it under, and its text. `part` is set on a chapter that is one of the parts
// of a longer one, `{ of, text }`: the list shows `of` once over the parts, and each part
// as `text` (`(thượng)`, `(2/5)`). The extraction below describes each chapter as a draft -
// `{ offset, group, heading }` - and finishChapters turns the drafts into these.
//
// heading: { type, number, part, title, text }
//   type    the word before the number: `Chương`, `Hồi`, `Phiên ngoại`
//   number  `27`, `1-6` for a run of chapters, `kết` for the last one
//   part    { text: 'thượng', bracketed } after the number (bracketed when it was written
//           `(thượng)`), { text: 'tiết 2', leading: true } before it
//   title   what the heading says besides, as written
//   text    the heading as it stands in the book
export type Part = { of: string; text: string };
export type Listed = { id: string; title: string; offset: number; group?: string; part?: Part };
export type Chapter = Listed & { content: string };
export type Heading = {
  type?: string;
  number?: string;
  part?: { text: string; bracketed?: boolean; leading?: boolean };
  title?: string;
  text?: string;
};
export type Draft = { offset: number; group?: string; heading: Heading };

export function chapterTitle({ type = 'Chương', number, part, title, text }: Heading, ordinal: number) {
  // a lone `/` or `|` after the chapter word was a separator with nothing behind it
  title = title?.replace(/^[\s/|\\]+/, '') ?? '';
  let isExtra = (s?: string) => /phiên ngoại/iu.test(s ?? '');
  let extra = isExtra(text) && !isExtra(title) && !isExtra(type) ? 'Phiên ngoại' : undefined;
  let label = [extra, number != null && `${type} ${number}`].filter(Boolean).join(' ');
  let named = [label, title.replace(/./, c => c.toUpperCase())].filter(Boolean).join(': ');
  let shown = part && !title.includes(`(${part.text})`) ? part : null;
  let full = [shown?.leading && `${shown.text}:`, named, shown && !shown.leading && `(${shown.text})`].filter(Boolean).join(' ');
  return full || `${type} ${ordinal + 1}`;
}

// the part a heading names after its title: `Yoga (thượng)`, `Dạ tập (nhị)`, `Chỉ nhiên (3)`,
// `Khánh công yến (hạ 6)【động đồ】`, or before it (`tiết 2`), as { stem, word, number, order,
// bracketed, tag }: the title without the part, the part as written, its number if it is
// written as one (`nhị` is 2, `thượng` is none), where it comes among the parts, whether it
// was in brackets, and a tag after it. A note in brackets (`(tu)`, `(nhuận)`) is no part.
// (`head` and `given` are what partsOf adds: see there)
type Mark = { stem: string; word?: string; number?: number | null; order: number; bracketed?: boolean; tag?: string; head?: boolean; given?: string };
const PART_MARK = /\s*[(（]\s*([^()（）]{1,16}?)\s*[)）]\s*(【[^】]*】)?\s*$/u;
function partMark({ title = '', part }: Heading): Mark | null {
  let marked = PART_MARK.exec(title);
  // a stray mark beside the part is none of it: `(lục ·)`
  let bare = (written?: string) => written?.toLowerCase().replace(/^[\s\p{P}]+|[\s\p{P}]+$/gu, '');
  let word = bare(part?.text ?? marked?.[1]);
  if(!word) return null;
  let number: number | null = part?.leading ? Number(/\d+$/.exec(word)?.[0] ?? NaN)
    : /^\d+$/.test(word) ? Number(word)
    : word in HALF_WORDS ? null : valueOfPart(word);
  if(Number.isNaN(number)) number = null;
  let half = /^(thượng|trung|hạ)(?:\s+(\d+))?$/u.exec(word);
  if(number == null && !half) return null;
  // `hạ 1`, `hạ 2` come after `hạ` and before each other
  let order = number ?? HALF_WORDS[half![1]] + Number(half![2] ?? 0) / 1000;
  let ours = marked && bare(marked[1]) === word ? marked : null;
  return {
    stem: (ours ? title.slice(0, ours.index) : title).trim(), word, number, order,
    bracketed: !!ours || !!part?.bracketed, tag: ours?.[2],
  };
}

// A chapter written in parts: the parts follow one another, in one book, with the one title
// and a part after it (`Yoga (thượng)`, `Yoga (hạ)`), under the one number or numbers that
// follow on. Each part is given `{ of, text }`: the title of the whole (`Chương 13: Yoga`,
// `Chương 9-11: Yoga`), and the part, as written or, when the parts are numbers, as `2/5`, in
// the brackets it was written in: `(thượng)`, `(2/5)`. Parts that are as many as the chapters
// the whole runs over are those chapters, and stay chapters, whatever their titles say: the
// three parts of `Chương 9-11` are chapters 9, 10 and 11. A chapter just before the parts with
// their title and no part of its own is their first part when the next is the second (`Na
// Trát`, then `Na Trát (2)`), and their heading when the next is the first and it holds
// nothing but its heading (`Thứ 13 chương tam đối`): it is given `{ head: true }`, and parts
// that left the title out are given the one it says as `title`. One with a text of its own
// stays a chapter, and parts that are all the one part (a heading the book repeats) are none
type PartOf = { head: true } | { head?: false; of?: string; text?: string; title?: string };
function partsOf(drafts: Draft[], text: string) {
  let headingOnly = (i: number) => text.slice(drafts[i].offset, drafts[i + 1]?.offset ?? text.length)
    .split('\n').filter(line => line.trim()).length <= TUNING.drafts.headingLines;
  let marks = drafts.map(({ heading }) => heading && partMark(heading));
  // `Thứ 55 chương` and a bare `56` are both chapters
  let together = (a: number, b: number) => drafts[a].group === drafts[b].group
    && (drafts[a].heading.type ?? 'Chương') === (drafts[b].heading.type ?? 'Chương');
  // how far the numbers go on from chapter a to chapter b, `152-153` to `154` being one
  let numbers = (i: number) => String(drafts[i].heading.number ?? '').split('-').map(Number);
  let step = (a: number, b: number) => drafts[a].heading.number === drafts[b].heading.number ? 0 : numbers(b)[0] - numbers(a).at(-1)!;
  marks.forEach((mark, i) => {
    let next = marks[i + 1];
    let title = drafts[i].heading?.title?.trim();
    if(mark || !next || !title || !together(i, i + 1) || step(i, i + 1) > 1) return;
    // parts that leave the title out, under the number of the chapter that gave it:
    // `Chương 13: Tam đối`, then `Chương 13 (thượng)`, `(trung)`, `(hạ)`
    let untitled = next.stem === '' && step(i, i + 1) === 0;
    if(title.toLowerCase() !== next.stem.toLowerCase() && !untitled) return;
    let second = next.number != null ? next.number === 2 : next.order > 1;
    let first = next.number != null ? next.number === 1 : next.order === 1;
    if(second) marks[i] = { stem: title, word: next.number != null ? '1' : 'thượng', number: next.number != null ? 1 : null, order: 1, bracketed: next.bracketed };
    else if(first && headingOnly(i)) marks[i] = { stem: title, head: true, order: 0 };
    else return;
    for(let j = i + 1; untitled && marks[j]?.stem === '' && step(i, j) === 0; j++) marks[j] = { ...marks[j]!, stem: title, given: title };
  });
  let follows = (a: number, b: number) => {
    let [from, to] = [marks[a], marks[b]];
    if(!from || !to || to.head || !together(a, b)) return false;
    if(from.stem.toLowerCase() !== to.stem.toLowerCase()) return false;
    // a book may skip a number between two parts with a title
    let named = from.stem !== '';
    let s = step(a, b);
    if(!(s === 0 || s === 1 || (named && s === 2))) return false;
    // the parts go forward: `27 (hạ)` then `28 (thượng)` is the next chapter's first part.
    // The same part again is the book repeating it
    return to.order > from.order || (to.order === from.order && (s === 0 || named));
  };
  let parts: (PartOf | undefined)[] = new Array(drafts.length);
  for(let start = 0, end = 0; start < drafts.length; start = end) {
    for(end = start + 1; end < drafts.length && follows(end - 1, end); end++);
    if(end - start < 2) continue;
    // a run is of marks that follow one another, none of them missing
    let run = marks.slice(start, end) as Mark[];
    let shown = run.filter(m => !m.head);
    if(new Set(shown.map(m => m.order)).size < 2) continue;
    let [first, last] = [drafts[start].heading, drafts[end - 1].heading];
    let number = first.number === last.number ? first.number : `${numbers(start)[0]}-${numbers(end - 1).at(-1)}`;
    let [from, to = from] = String(number ?? '').split('-').map(Number);
    if(to - from + 1 === shown.length) {
      run.forEach((m, k) => { parts[start + k] = m.head ? { head: true } : { title: m.given }; });
      continue;
    }
    let of = chapterTitle({ ...first, number, part: undefined, title: run[0].stem }, start);
    let numbered = shown.every(m => m.number != null);
    let total = Math.max(new Set(shown.map(m => m.order)).size, ...shown.map(m => m.number ?? 0));
    run.forEach((m, k) => {
      let said = numbered ? `${m.number}/${total}` : m.word;
      parts[start + k] = m.head ? { head: true } : { of, text: [m.bracketed ? `(${said})` : said, m.tag].filter(Boolean).join(' '), title: m.given };
    });
  }
  return parts;
}

// the drafts, in order, as chapters: each one runs to where the next begins. The heading of
// a chapter's parts holds nothing but itself, so it begins the first part, which opens with
// the chapter's title, and the parts that left the title out take it
export function finishChapters(drafts: Draft[], text: string): Chapter[] {
  let parts = partsOf(drafts, text);
  let kept: (Draft & { part?: Part })[] = [];
  drafts.forEach((draft, i) => {
    let part = parts[i];
    if(part?.head) return;
    kept.push({
      ...draft,
      offset: parts[i - 1]?.head ? drafts[i - 1].offset : draft.offset,
      heading: part?.title ? { ...draft.heading, title: part.title } : draft.heading,
      part: part?.of != null ? { of: part.of, text: part.text ?? '' } : undefined,
    });
  });
  return kept.map(({ offset, group, heading, part }, i) => {
    let title = chapterTitle(heading, i);
    let end = kept[i + 1]?.offset ?? text.length;
    return { id: `${slug(title)}-${i}`, title, offset, group, part, content: text.slice(offset, end).trim() };
  });
}

// ---- tuning -------------------------------------------------------------------------
// Every number the parser was tuned with, and what it is for. They were set by running
// the parser over a library of books (tools/check-books.ts); change one and run it again.
const TUNING = {
  // 3. how much a heading speaks for itself, 0 to 10, before the book's own style weighs in
  base: {
    decimal: 2,          // `3.07` is hardly ever anything but a chapter
    digits: 1.5,         // a number in digits, bare, beside a title: sentences rarely begin with one
    thien: -4,           // `Cửu thiên chi thượng ...`: `thiên` is a chapter word only now and then
    phraseAlone: 1,      // `Kỳ Bạch Tuyết (nhất)` with nothing after it
    bookAlone: 3,        // a book heading on its own line, or `Quyển thứ nhất: Kinh thành phong vân`
    bookTitle: 8,        // `Tên sách: Ngoại truyện: Ba cái tiểu xử nữ`, one of the books a file holds
    bookTitleMax: 40,    // ...with a title no longer than this
    bookProse: -10,      // a book word that begins a sentence: `Hai bộ ngực ...`
    markerProseMax: 2,   // the most a paragraph running on behind `Chương 10:` counts against it
    titlePage: -6,       // `【NAME】1-74 tác giả: ...`
    roman: -2,           // roman numerals read as a word more often than as a number
    inline: 3,           // a heading in the middle of a line
    runsOn: -1,          // one at the start of a line its chapter's text runs on in
    inlineNumbersAmong: 5, // `(12)` alone on a line, as often as this, for `... (13)` to be one too
    inlineTitleMax: 80,  // and the title it is given, in characters
  },
  // 3. how much a line reads like a sentence of the story and not like a title
  prose: {
    longerThan: 100, long: 3,         // a line this long
    commas: 2, manyCommas: 2,         // this many commas
    oneCommaOver: 40, oneComma: 1,    // one comma in a line this long
    sentenceOver: 50, sentence: 2,    // a line this long that ends like a sentence
  },
  // 4. the path: what a step from one heading to the next is worth
  reward: {
    next: 8,             // n after n-1
    gap: 3,              // taken off for each number a jump skips
    repeat: 3,           // the same heading again, close by
    boundary: 7,         // the numbers start over where a book or extra begins
    carryOn: 4,          // ...or go on from where the book before stopped
    restart: -6,         // ...and where nothing says so
    half: 4,             // the next part of a chapter
    end: 6,              // the last chapter
    interlude: 1,        // a piece set between two chapters
  },
  path: {
    threshold: 4.5,      // what a heading must be worth to be on the path by itself
    closeLines: 3,       // lines apart that two headings may still be one
    gapMax: 10,          // how far a jump may go (each number it skips costs `reward.gap`)
    smallNumber: 3,      // a number up to this may be the first of a book
    startAlone: 3,       // worth of a path that starts at a small number...
    startFar: -6,        // ...and at any other
    lateStartCost: 4,    // a book that starts at a big number, off the boundary reward
    lateStartCap: 10,    // ...up to this many
    opensExtraLines: 4,  // lines after `Kỳ Bạch Tuyết phiên ngoại` its first chapter may stand
    breakMinBase: 6,     // how much a heading must say for itself to break the numbers
    unnamedFrom: 6,      // the numbers starting over after this many chapters is a new book...
    unnamedUpTo: 2,      // ...when they start over at this or lower
    endLookback: 40,     // headings back an end (`Chương kết`) looks for the chapter it closes
    endMin: 2,           // ...which must be at least this number
    skippedBooksMax: 3,  // books never named that a named one may skip over
  },
  // 4. how far a shape is trusted, by how much of it landed on the path
  trust: { scale: 6 },
  // 4. a heading with a line or so before the next, in a book of long chapters
  tiny: { typicalAtLeast: 30, lines: 2, chars: 3000 },
  // 4. a contents list at the head of a book: this many entries, from the least to the most
  contents: { minEntries: 3, maxEntries: 60 },
  // 4. weak headings taken back to fill a gap: the first of a book up to this number
  fill: { firstMax: 4 },
  // 5. the drafts
  drafts: {
    titleMax: 100,       // characters of a title, before a paragraph running on is cut
    seriesMin: 8,        // headings that begin alike, to be a series
    seriesOver: 1.2,     // ...and more than the numbered headings by this factor
    pageParagraphs: 60,  // paragraphs to a page, when a book has no headings
    headingLines: 2,     // lines of a chapter that holds nothing but its heading (of its parts)
  },
};

// ---- the parser ---------------------------------------------------------------------
// Contents, in the order of the file:
//   1. Words and numbers   `hai mươi tư`, `nhất lẻ một`, `XIV` as numbers
//   2. Lines into tokens   a line as a string of classes (number, chapter word, bracket, ...)
//   3. Headings            the shapes a heading takes, and the candidate found at each line
//   4. The path            the best way through the candidates, and the checks around it
//   5. Drafts              the path as chapters, or pages, or a series, and the title page
//   6. extractChapters     the whole, in a few lines
//
// The headings of a book are the lines whose numbers run in sequence: 1, 2, 3 ... A line
// that merely looks like a heading (`Một giờ sau...`, `Kết quả là...`) has a number that
// fits nowhere in that sequence, so the sequence is what is looked for, not the look.
//
//   findCandidates    every line that could be a heading, read into a node (number,
//                       marker words, book, title) with how much its shape speaks for it
//   chooseHeadings    the best path through the nodes: a number followed by the next one
//                       scores, a repeat close by is the same heading, a jump costs, a
//                       book or an extra (phiên ngoại) may start the numbers over
//   buildChapters     the chosen nodes become chapters, with their title and book
//
// A shape (`【N】`, `Chương N: T`, `(N) T`) that mostly lands on the path is trusted
// more on a second look, so a book's own style outweighs the one-off lines.

// ==== 1. Words and numbers ===================================================================
const WORD_DIGITS: Record<string, number> = { một: 1, mốt: 1, hai: 2, ba: 3, bốn: 4, tư: 4, năm: 5, lăm: 5, sáu: 6, bảy: 7, tám: 8, chín: 9 };
const SINO_DIGITS: Record<string, number> = { nhất: 1, nhị: 2, tam: 3, tứ: 4, ngũ: 5, lục: 6, thất: 7, bát: 8, cửu: 9 };
// the units that may follow `mươi`: `hai mươi tư` is 24, `ba mươi mốt` 31 (`mốt` and `lăm` are
// the forms a unit takes there)
const TENS_UNITS = ['mốt', 'hai', 'ba', 'bốn', 'tư', 'lăm', 'sáu', 'bảy', 'tám', 'chín'];
// the words a number written out begins with: a word of the text that is none of them is no
// number, whatever follows it
const NUMBER_STARTS = new Set(['mười', 'thập', ...Object.keys(WORD_DIGITS), ...Object.keys(SINO_DIGITS)]);

// the longest number the words at `i` read as: { value, length } in words, or null
export function readNumberWords(words: string[], i: number): { value: number; length: number } | null {
  if(!NUMBER_STARTS.has(words[i])) return null;
  let w = (k: number) => words[i + k];
  let best: { value: number; length: number } | null = null;
  let take = (value: number, length: number) => {
    if(!best || length > best.length) best = { value, length };
  };
  // 100-199 read out digit by digit: `nhất lẻ loi` is 100, `nhất lẻ một` 101,
  // `nhất nhất linh` 110. `lẻ loi` stands for two zeros, `lẻ` and `linh` for one
  if(w(0) === 'nhất') {
    let digit = (x: string) => (x === 'lẻ' || x === 'linh') ? 0 : (SINO_DIGITS[x] ?? WORD_DIGITS[x]);
    if(w(1) === 'lẻ' && w(2) === 'loi') take(100, 3);
    if(['lẻ', 'linh', ...Object.keys(SINO_DIGITS)].includes(w(1)) && digit(w(2)) != null) {
      take(100 + 10 * digit(w(1)) + digit(w(2)), 3);
    }
  }
  if(w(0) === 'mười') {
    take(10, 1);
    if(w(1) in WORD_DIGITS && w(1) !== 'tư') take(10 + WORD_DIGITS[w(1)], 2);
  }
  if(w(0) in WORD_DIGITS) {
    take(WORD_DIGITS[w(0)], 1);
    if(w(1) === 'mươi') {
      let tens = 10 * WORD_DIGITS[w(0)];
      take(tens, 2);
      if(TENS_UNITS.includes(w(2))) take(tens + WORD_DIGITS[w(2)], 3);
    }
  }
  let sino = (k: number) => SINO_DIGITS[w(k)];
  if(w(0) === 'thập') {
    take(10, 1);
    if(sino(1)) take(10 + sino(1), 2);
  }
  if(sino(0)) {
    take(sino(0), 1);
    if(w(1) === 'thập') {
      take(sino(0) * 10, 2);
      if(sino(2)) take(sino(0) * 10 + sino(2), 3);
    }
  }
  return best;
}

const ROMAN_VALUES: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
function readRoman(word: string) {
  if(!/^[IVXLCDM]+$/.test(word)) return null;
  let total = 0;
  for(let k = 0; k < word.length; k++) {
    let [a, b] = [ROMAN_VALUES[word[k]], ROMAN_VALUES[word[k + 1]] ?? 0];
    total += a < b ? -a : a;
  }
  return total > 0 && total < 4000 ? total : null;
}

// ==== 2. Lines into tokens ===================================================================
// A token's class is one letter:
//   N number   E end word (kết, cuối)   c chapter word   p phiên ngoại / ngoại truyện
//   b book word   t thứ / đệ   f tiết   h thượng / trung / hạ
//   n the book's own name   L opening bracket   R closing bracket   S other mark   x any word
const CHAPTER_WORDS: Record<string, string> = { chương: 'Chương', hồi: 'Hồi', thiên: 'Thiên' };
const BOOK_WORDS: Record<string, string> = { quyển: 'Quyển', tập: 'Tập', bộ: 'Bộ', cuốn: 'Cuốn', quý: 'Quý' };
const HALF_WORDS: Record<string, number> = { thượng: 1, trung: 2, hạ: 3 };
// A token: its class, where it starts and ends in its line, its text, and what its class
// carries: a number's value (and the book of `3.07`, and whether it was written in digits, in
// Sino-Vietnamese or in roman numerals), a word's form as shown (`Chương`, `Quyển`)
type Token = {
  cls: string; s: number; e: number; text: string;
  value?: number; book?: number | null; digits?: boolean; sino?: boolean; roman?: boolean; word?: string;
};
type Carried = Pick<Token, 'value' | 'word'>;
type KnownWord = [string, [string, Carried]];
// the words that are a class of token by themselves (a class and what it carries), and the
// phrases of two words that are
const KNOWN_WORDS = new Map<string, [string, Carried]>([
  ...Object.entries(CHAPTER_WORDS).map(([word, shown]): KnownWord => [word, ['c', { word: shown }]]),
  ...Object.entries(BOOK_WORDS).map(([word, shown]): KnownWord => [word, ['b', { word: shown }]]),
  ...Object.entries(HALF_WORDS).map(([word, value]): KnownWord => [word, ['h', { value, word }]]),
  ['thứ', ['t', {}]], ['đệ', ['t', {}]], ['tiết', ['f', {}]],
]);
const KNOWN_PHRASES: [string, string, string][] = [['phiên ngoại', 'p', 'Phiên ngoại'], ['ngoại truyện', 'p', 'Ngoại truyện'], ['giai đoạn', 'b', 'Giai đoạn']];

// the token a word or a phrase of two begins, as [class, what it carries, its length], or null
function readKnownWord(word: string, lower: string, pos: number): [string, Carried, number] | undefined {
  for(let [phrase, cls, shown] of KNOWN_PHRASES) {
    if(lower.startsWith(phrase, pos)) return [cls, { word: shown }, phrase.length];
  }
  let known = KNOWN_WORDS.get(word);
  return known && [...known, word.length];
}

const OPENERS = '【[(（《“"«';
const CLOSERS = '】])）》”"»';
// what lexLine reads, where it stands in the line: a sticky pattern matches there, so the rest
// of the line is never copied to be read (every line of the book is lexed)
const DIGITS = /\d+(?:\.\d+)?/y;
const LETTERS = /\p{L}+/uy;
const NEXT_WORD = / \p{L}+/uy;
const NEXT_MARK = /\s*(\S)/y;
// what a number says when it counts a chapter's words: `2.4 vạn chữ`, `8000 chữ`, `5 ngàn chữ`. Only
// as many as a chapter has: `087 vạn chữ đại càng` (870,000 words) is chapter 87, its title saying
// how long it is, and so is `Chương 87 vạn chữ ...`
const WORD_COUNT = /\s*(vạn|ngàn|nghìn|k|w)?\s*chữ(?![\p{L}\p{N}])/uy;
const countsWords = (value: number, decimal: boolean, unit?: string) => (
  decimal || (unit === 'vạn' || unit === 'w' ? value < 20 : unit ? value < 100 : value >= 300)
);
const readAt = (re: RegExp, line: string, pos: number) => {
  re.lastIndex = pos;
  return re.exec(line);
};

function lexLine(line: string, lower: string, names: string[]) {
  let tokens: Token[] = [];
  let pos = 0;
  while(pos < line.length && tokens.length < 18) {
    let ch = line[pos];
    if(/\s/.test(ch)) { pos++; continue; }
    let add = (cls: string, end: number, extra: Partial<Token> = {}) => {
      tokens.push({ cls, s: pos, e: end, text: line.slice(pos, end), ...extra });
      pos = end;
    };
    let name = names.find(n => lower.startsWith(n, pos) && !/\p{L}/u.test(lower[pos + n.length] ?? ''));
    if(name) { add('n', pos + name.length); continue; }
    if(OPENERS.includes(ch)) { add('L', pos + 1); continue; }
    if(CLOSERS.includes(ch)) { add('R', pos + 1); continue; }
    if(/\d/.test(ch)) {
      let m = readAt(DIGITS, line, pos)!;
      let [major, minor] = m[0].split('.');
      // `0.05` is a fraction (a countdown, a price), not chapter 5 of a book 0; `1.2 vạn chữ` is
      // how long the chapter is
      if(minor != null && Number(major) === 0) { add('x', pos + m[0].length); continue; }
      let count = !['c', 't'].includes(tokens.at(-1)?.cls ?? '') && readAt(WORD_COUNT, lower, pos + m[0].length);
      if(count && countsWords(Number(m[0]), minor != null, count[1])) { add('x', pos + m[0].length); continue; }
      // `3.40` is chapter 40 of book 3
      add('N', pos + m[0].length, { value: Number(minor ?? major), book: minor == null ? null : Number(major), digits: true });
      continue;
    }
    let letters = readAt(LETTERS, line, pos);
    if(!letters) { add('S', pos + 1); continue; }
    let word = letters[0];
    let lowered = lower.slice(pos, pos + word.length);
    // the words that follow, for the numbers that take several; only a number takes them
    let words = [lowered];
    let ahead = pos + word.length;
    for(let k = 0; k < 4 && NUMBER_STARTS.has(lowered); k++) {
      let next = readAt(NEXT_WORD, line, ahead);
      if(!next) break;
      words.push(lower.slice(ahead + 1, ahead + next[0].length));
      ahead += next[0].length;
    }
    let number = readNumberWords(words, 0);
    if(number) {
      // the end of the last word it read
      let end = pos;
      for(let k = 0; k < number.length; k++) end += (k ? 1 : 0) + words[k].length;
      add('N', end, { value: number.value, sino: words[0] in SINO_DIGITS || words[0] === 'thập' });
      continue;
    }
    let roman = readRoman(word);
    let end = pos + word.length;
    let known = readKnownWord(lowered, lower, pos);
    if(roman != null && word.length <= 7) add('N', end, { value: roman, roman: true });
    else if(known) add(known[0], pos + known[2], known[1]);
    else if(lowered === 'kết' || lowered === 'cuối') {
      // `Chương kết` ends the book; `Kết quả là` and `Cuối cùng` are only sentences
      let after = readAt(NEXT_MARK, line, end);
      let lone = !after || /[^\p{L}\p{N}]/u.test(after[1]);
      add(lone ? 'E' : 'x', end, { word: lowered });
    }
    else add('x', end);
  }
  return tokens;
}

// ==== 3. Headings ============================================================================
// A heading found in the text, a candidate for a chapter. Every one has all of these:
//   kind      'chap' | 'book' | 'extrahead' | 'half' | 'interlude'
//   base      how much it speaks for itself, 0-10, before the book's own style weighs in
//   where     index (in the text), start (in its line), ord (the rank of its line among the
//             lines that have anything in them)
//   said      text (the heading as written), title (what follows), rest (the line after it),
//             whole (nothing follows)
//   shape     what it looks like, for the trust a book gives that look
//   chapter   n, span (the last of a run: `7-10`), end / endWord (`kết`, `cuối`), chapType,
//             extra (phiên ngoại), and a part of it: half (1 thượng, 2 trung, 3 hạ, or a
//             number), halfText, halfBracketed (written `(hạ)`), halfNum, halfType
//   book      bookNum, bookType, and bookName for a book that names itself and has no
//             number (`Tên sách: Ngoại truyện: Ba cái tiểu xử nữ`)
//   outer     the section it is a part of: `Chương 2: Tiên tử chi ân | thứ 3 hồi ...`
//   inline    found in the middle of a line, not at its start
//   runsOn    at the start of a line too long to be a heading, its chapter's text running on
type Candidate = {
  kind: 'chap' | 'book' | 'extrahead' | 'half' | 'interlude';
  base: number;
  index: number; start: number; ord: number;
  text: string; title: string; rest: string; whole: boolean;
  shape: string;
  n: number | null; span: number | null; end: boolean; endWord: string | null; chapType: string | null; extra: boolean;
  half: number | null; halfText: string | null; halfBracketed: boolean; halfNum: number | null; halfType: string | null;
  bookNum: number | null; bookType: string | null; bookName: string | null;
  outer: string | null;
  inline: boolean;
  runsOn: boolean;
};
const HEADING_DEFAULTS: Candidate = {
  kind: 'chap', base: 0, index: 0, start: 0, ord: 0, text: '', title: '', rest: '', whole: false, shape: '',
  n: null, span: null, end: false, endWord: null, chapType: null, extra: false,
  half: null, halfText: null, halfBracketed: false, halfNum: null, halfType: null,
  bookNum: null, bookType: null, bookName: null, outer: null, inline: false, runsOn: false,
};

function heading(fields: Partial<Candidate>): Candidate {
  return { ...HEADING_DEFAULTS, ...fields };
}

// the shapes a heading can take, over the token classes. The first that fits wins
const DECOR = '[LS]*';
const NAME_PART = '(?:nR?S?)?';
const BOOK_PART = '(?:(?<bm>b)t?(?<bn>N)|(?<bt>t)(?<bn2>N)(?<bm2>b)|(?<bn3>N)(?<bm3>b))R?S?';
// the book after the chapter, in brackets: `Thứ 1 chương (bộ 02) chi du thuyền xuân sắc`
const BOOK_AFTER = '(?:L(?<bm4>b)t?(?<bn4>N)R)?';
// a rule: what a heading of its shape is and how much it speaks for itself (with a title after
// it, `weakTitled`), and the shape, over the classes of the tokens
type Rule = { kind: Candidate['kind']; base: number; weakTitled?: number; sino?: boolean; re: RegExp };
const HEADING_RULES = ([
  // Chương 5 | Chương kết | Thứ 5 chương | Ba mươi tám chương | Quyển 2 Chương 7 | 【NAME】 Chương 5
  // | Thứ 1 chương (bộ 02)
  { kind: 'chap', base: 9, re: `^${DECOR}${NAME_PART}${DECOR}(?:${BOOK_PART}[xc]{0,10})?${DECOR}(?:(?<pm0>p)?(?<cm>[cp])(?<cn>[NE])|(?<tt>t)?(?<cn2>[NE])(?<cm2>c))${BOOK_AFTER}` },
  // Phiên ngoại: 【1】 title
  { kind: 'chap', base: 9, re: `^${DECOR}(?<cm>p)[LS]+(?<cn>N)R?` },
  // Thứ 7-10 chương: several chapters under one heading
  { kind: 'chap', base: 9, re: `^${DECOR}(?<tt>t)?(?<cn>N)S(?<cn3>N)(?<cm2>c)` },
  // 【NAME】9 | NAME #3 | NAME (5) | 《NAME》2
  { kind: 'chap', base: 7, re: `^${DECOR}nR?S?${DECOR}(?<cn>N)R?` },
  // Quyển thứ ba 3: the chapter's number follows its book's
  { kind: 'chap', base: 7, re: `^${DECOR}${NAME_PART}${DECOR}${BOOK_PART}${DECOR}(?<cn>N)` },
  // Quyển thứ hai | Bộ 2 | Thứ 4 cuốn
  { kind: 'book', base: 6, re: `^${DECOR}${NAME_PART}${DECOR}${BOOK_PART}` },
  // Kỳ Bạch Tuyết phiên ngoại
  { kind: 'extrahead', base: 5, re: '^[LS]*x{1,8}(?<pm>p)$' },
  // Tiết thứ hai | Thứ 1 tiết
  { kind: 'half', base: 5, re: '^[LS]*(?:f t?(?<hn>N)|t(?<hn2>N)f)' },
  // Nhất, trong sương mù đường về: a Sino-Vietnamese ordinal and a comma
  { kind: 'chap', base: 5, weakTitled: 4.5, sino: true, re: '^(?<cn>N)(?<sep>S)' },
  // (5) | 【nhất】 | 5. | 22) | 2,
  { kind: 'chap', base: 5, weakTitled: 3, re: '^L?(?<cn>N)R?' },
  // Phòng tắm thiên Chương 1: a few words, then the chapter
  { kind: 'chap', base: 6, re: '^[LS]*(?<pre>[xc]{1,6})(?<cm>c)(?<cn>N)(?![xNE])' },
  // Kỳ Bạch Tuyết (nhất) | Kiều thê chuyện xưa (nhất) | Quy tắc quái đàm — mới vào học viện (1)
  { kind: 'chap', base: 4, re: '^[LS]*(?<ph>[xS]{1,16})L(?<cn>N)R' },
  // (hạ)
  { kind: 'half', base: 5, re: '^(?<hl>L)?(?<hm>h)R?$' },
] satisfies (Omit<Rule, 're'> & { re: string })[]).map((rule): Rule => ({ ...rule, re: new RegExp(rule.re, 'd') }));

// where a group of a rule's match is, in tokens
const spanOf = (m: RegExpExecArray, group: string) => m.indices?.groups?.[group];

// the title a line carries after its heading: no separator left in front, no bracket behind
export function cleanTitle(rest: string) {
  let title = rest.replace(/^[\s:：.,\-—–/|)\]】”"»*#!·•]+/u, '').trimEnd();
  // a closing bracket with nothing opened before it goes; one that closes a tag stays
  while(/[】\]”"»]$/u.test(title) && (title.match(/[】\]”"»]/gu) || []).length > (title.match(/[【[“«]/gu) || []).length) {
    title = title.slice(0, -1).trimEnd();
  }
  return title;
}

// how much a line reads like a sentence of the story and not like a title
function proseCost(rest: string) {
  let t = TUNING.prose;
  let cost = 0;
  let commas = (rest.match(/[,;]/g) || []).length;
  if(rest.length > t.longerThan) cost += t.long;
  if(commas >= t.commas) cost += t.manyCommas;
  else if(commas === 1 && rest.length > t.oneCommaOver) cost += t.oneComma;
  if(rest.length > t.sentenceOver && /[.!?…"”]$/.test(rest)) cost += t.sentence;
  return cost;
}

function leadingTitle(m: RegExpExecArray, tokens: Token[], line: string, rest: string) {
  let span = spanOf(m, 'pre') ?? spanOf(m, 'ph');
  if(!span) return null;
  let words = tokens.slice(span[0], span[1]);
  let dash = spanOf(m, 'ph') ? words.findLastIndex(t => t.cls === 'S') : -1;
  let from = words[dash + 1] ?? words[0];
  return cleanTitle([line.slice(from.s, words.at(-1)!.e), cleanTitle(rest)].filter(Boolean).join(' '));
}

// what a matched rule says: the chapter's number, its markers, the book and half it names
type Roles = { roles: Partial<Candidate>; number: Token | null; marker: Token | null };
function readRoles(rule: Rule, at: (group: string) => Token | null): Roles {
  let roles: Partial<Candidate> = {};
  let number = at('cn') ?? at('cn2');
  let marker = at('cm') ?? at('cm2');
  if(rule.kind === 'chap' && number) {
    if(number.cls === 'E') Object.assign(roles, { end: true, endWord: number.word });
    else {
      roles.n = number.value;
      if(number.book != null) roles.bookNum = number.book;
    }
    if(marker) {
      roles.chapType = marker.word ?? marker.text;
      if(marker.cls === 'p' || at('pm0')) {
        roles.extra = true;
        roles.chapType = (at('pm0') ?? marker).word;
      }
    }
  }
  let span = at('cn3');
  if(span) roles.span = span.value;
  let bookNumber = at('bn') ?? at('bn2') ?? at('bn3') ?? at('bn4');
  if(bookNumber) {
    roles.bookNum = bookNumber.value;
    roles.bookType = (at('bm') ?? at('bm2') ?? at('bm3') ?? at('bm4'))?.word;
  }
  if(rule.kind === 'extrahead') roles.extra = true;
  if(rule.kind === 'half') {
    let numbered = at('hn') ?? at('hn2');
    if(numbered) Object.assign(roles, { halfNum: numbered.value, halfType: 'tiết', half: numbered.value });
    else Object.assign(roles, { half: at('hm')?.value, halfText: at('hm')?.word, halfBracketed: !!at('hl') });
  }
  return { roles, number, marker };
}

// how much the heading speaks for itself, 0-10, before the book's own style weighs in
type Said = { title: string; rest: string; whole: boolean; hasRoman: boolean; hasPhrase: boolean; titled: boolean };
function baseOf(rule: Rule, { roles, number, marker }: Roles, { title, rest, whole, hasRoman, hasPhrase, titled }: Said) {
  let base = rule.base;
  // a bare number with a title after it is the weakest shape of all; in digits less so
  if(rule.weakTitled != null && !whole) base = rule.weakTitled + (roles.bookNum != null ? TUNING.base.decimal : 0) + (number?.digits ? TUNING.base.digits : 0);
  // `3.07` is hardly ever anything but a chapter
  else if(number?.book != null) base += TUNING.base.decimal;
  if(marker?.cls === 'c' && marker.word === 'Thiên') base += TUNING.base.thien;
  if(hasPhrase && whole) base += TUNING.base.phraseAlone;
  // a book heading must stand on its own line to be believed, or be followed by a colon and
  // a short title (`Quyển thứ nhất: Kinh thành phong vân`): `Hai bộ ngực...` is prose
  // (`(quyển thứ nhất: Hoàn!)` ends a volume, it does not open one; a phase is only a heading alone)
  let ending = /(?:^|\s)(?:hoàn|xong|kết thúc)(?:$|[\s.!)])/iu.test(title);
  let bookMax = TUNING.base.bookTitleMax;
  if(rule.kind === 'book') base += whole || (titled && title.length <= bookMax && !ending) ? TUNING.base.bookAlone : (title.length > bookMax || ending || roles.bookType === 'Giai đoạn' ? TUNING.base.bookProse : 0);
  // a heading with its marker (`Chương 10: ...`) is still one when the paragraph runs on
  // behind it on the same line; only a bare number is made doubtful by that
  base -= marker ? Math.min(proseCost(title), TUNING.base.markerProseMax) : proseCost(title);
  // the title page: `【NAME】1-74 tác giả: ...`
  if(/tác giả/.test(rest) || /^\s*[-–~]\s*\d/.test(rest)) base += TUNING.base.titlePage;
  if(hasRoman) base += TUNING.base.roman;
  return base;
}

// the classes up to the heading's end, runs of words as one. A number written in
// digits is told from one in words: sentences begin with `Một` by the hundred and with
// `192` almost never, and `3.07` is a chapter
function shapeOf(tokens: Token[], length: number, whole: boolean) {
  let spelled = tokens.slice(0, length).map(t => t.cls !== 'N' ? t.cls : t.book != null ? 'D' : t.digits ? '#' : 'N').join('');
  return spelled.replace(/x+/g, 'X') + (whole ? '' : 'T');
}

// `Chính văn` (the main text, as against the extras) labels a heading and is no part of it, and
// so does the day a chapter was posted, in front of the word that says it is one:
// `2018-11-18【Chương 8: ...` (`2004.01.06 trễ cho trong nhà` is an entry of a diary, its date
// all there is to number it by)
const SECTION_LABEL = /^\s*(?:chính văn\s+|\d{4}[-./]\d{1,2}[-./]\d{1,2}\s*(?=[【[(（]?\s*(?:chương|hồi|thứ\s)))(?=\S)/iu;
// a line too long to be a heading may still begin with one, the chapter's text running on behind it
// on the one line (a chapter posted as a single paragraph), when it is set apart in front: by the
// day it was posted, `Chính văn`, or a bracket (`2018-11-18【Chương 10: ...`). A bare `Chương 3: ...`
// at the head of a paragraph is told from a sentence about chapter 3 by nothing, and a book of such
// paragraphs is better read in pages than in the few chapters it would be cut into
const LONG_LINE_HEADING = /^\s*(?:chính văn\s+|\d{4}[-./]\d{1,2}[-./]\d{1,2}\s*[【[(（]?|[【[(（])\s*(?:(?:chương|hồi)\s+\d{1,4}|thứ\s+\d{1,4}\s+(?:chương|hồi))(?![\p{L}\p{N}])/iu;
const HEADING_READ = 400;
// characters into such a line that its heading, found again in it, is still the same one
const HEADING_SAME_WITHIN = 40;

// a chapter in parts: `Chương 27: (thượng)`, `Chương 44: (nhất)`, or a title that ends in
// `(hạ)`. The parts are shown one by one, each as the part of its chapter
function partOf(title: string) {
  let alone = /^\(\s*(\p{L}+(?: \p{L}+)*)\s*\)$/u.exec(title);
  if(alone) {
    let value = valueOfPart(alone[1].toLowerCase());
    if(value != null) return { half: value, halfText: alone[1].toLowerCase(), title: '' };
  }
  let ending = /\s*\((thượng|trung|hạ)\)$/iu.exec(title);
  if(ending) return { half: HALF_WORDS[ending[1].toLowerCase()], halfText: ending[1].toLowerCase(), title };
  return null;
}

// the number a part is written as: `thượng` is 1, `hạ` 3, `nhất` 1, `hai mươi` 20; null if it is no number
function valueOfPart(word: string) {
  if(word in HALF_WORDS) return HALF_WORDS[word];
  let words = word.split(' ');
  let number = readNumberWords(words, 0);
  return number?.length === words.length ? number.value : null;
}

// `Tên sách: Ngoại truyện: Ba cái tiểu xử nữ`: the title of one of the books a file holds
const BOOK_TITLE = /^\s*tên sách\s*[:：]\s*(\S.*?)\s*$/iu;

function readHeading(line: string, lower: string, names: string[], cut = false): Candidate | null {
  // (what runs on behind the heading of a chapter posted as one paragraph is that paragraph, and
  // no title)
  let runsOn = cut || line.length > HEADING_READ;
  if(line.length > HEADING_READ) {
    if(!LONG_LINE_HEADING.test(line)) return null;
    line = line.slice(0, HEADING_READ);
    lower = lower.slice(0, HEADING_READ);
  }
  let named = BOOK_TITLE.exec(line);
  if(named) {
    return heading({ kind: 'book', base: TUNING.base.bookTitle, bookName: named[1], title: named[1], text: line.trim(), start: line.search(/\S/), shape: 'named' });
  }
  let label = SECTION_LABEL.exec(line);
  if(label) {
    let node = readHeading(line.slice(label[0].length), lower.slice(label[0].length), names, runsOn);
    return node && { ...node, start: label[0].search(/\S/) };
  }
  let tokens = lexLine(line, lower, names);
  if(!tokens.some(t => 'NEhbp'.includes(t.cls))) return null;
  let classes = tokens.map(t => t.cls).join('');
  for(let rule of HEADING_RULES) {
    let m = rule.re.exec(classes);
    if(!m) continue;
    let at = (group: string) => {
      let span = spanOf(m, group);
      return span ? tokens[span[0]] : null;
    };
    // `một hồi` (a while) and `chín thiên` are not chapters: only `chương` follows a number alone
    if(at('cm2') && at('cm2')?.word !== 'Chương' && !at('tt')) continue;
    if(rule.sino && (!at('cn')?.sino || at('sep')?.text !== ',')) continue;
    let last = tokens[m[0].length - 1];
    let rest = line.slice(last.e);
    let whole = !/\S/.test(rest);
    let read = readRoles(rule, at);
    // `Thứ 6 chương Chương 6: Cao trào...` and `Thứ 8 chương thật · Chương 8:: Đại tỷ...`
    // say the chapter twice; the title is what follows the second
    let title = leadingTitle(m, tokens, line, rest) ?? cleanTitle(rest);
    // `(bộ 02) chi du thuyền xuân sắc`: `chi` (of) ties the book to its name
    if(at('bn4')) title = title.replace(/^chi\s+/iu, '');
    if(read.roles.n != null) {
      title = title.replace(new RegExp(`^(?:\\S+\\s+){0,3}?(?:chương|hồi)\\s+${read.roles.n}\\s*[:：.]*\\s*`, 'iu'), '');
    }
    let part = read.roles.n != null && !runsOn && partOf(title);
    let hasRoman = tokens.some(t => t.roman);
    let base = baseOf(rule, read, { title, rest, whole, hasRoman, hasPhrase: !!at('ph'), titled: /^[:：]$/.test(last.text) });
    // a heading the chapter's text runs on behind is weighed with that text, and a little less
    // than one on its own line: a note that begins `Chương 7: ...` reads the same. What runs on
    // is no title
    if(runsOn) {
      base += TUNING.base.runsOn;
      title = '';
    }
    // `Thứ 0 chương` sets a piece between two chapters; a bare 0 (a door code, a countdown) is nothing
    if(read.roles.n === 0 && !read.marker) continue;
    if(part) title = part.title;
    let kind = rule.kind === 'chap' && read.roles.n === 0 ? 'interlude' : rule.kind;
    // `Chương 2: Tiên tử chi ân | thứ 3 hồi ...`: the heading of a section, then the one
    // of the part that begins here. The part is the chapter, the section its group
    let inner = rule.kind === 'chap' && read.roles.n != null
      && (/^(.*?)\s*[|｜]\s*(\S.*)$/u.exec(rest) ?? /^(.*?)\s*[【[]?\s*(thứ\s+\S+\s+hồi\b.*)$/iu.exec(rest));
    if(inner) {
      let held = readHeading(inner[2].replace(/^[【[]\s*/, ''), inner[2].replace(/^[【[]\s*/, '').toLowerCase(), names);
      if(held && held.kind === 'chap' && held.n != null && !held.outer) {
        let outer = `${read.marker?.word ?? 'Chương'} ${read.roles.n}`;
        return heading({ ...held, outer: [outer, cleanTitle(inner[1])].filter(Boolean).join(': '), start: tokens[0].s, text: line.slice(tokens[0].s) });
      }
    }
    return heading({
      // (a part in the title is one in brackets: `(thượng)`)
      ...read.roles, ...(part && { half: part.half, halfText: part.halfText, halfBracketed: true }), kind, base, rest, title, whole,
      shape: shapeOf(tokens, m[0].length, whole),
      runsOn,
      text: line.slice(tokens[0].s, last.e),
      start: tokens[0].s,
    });
  }
  return null;
}

// a heading written into the middle of a paragraph: `... Chương 101 ...`
const INLINE_HEADING = /(?<![\p{L}\p{N}])(?<word>chương|hồi)\s+(?<n>\d{1,4})(?![\p{L}\p{N}.])/giu;
// a bracketed number run on behind a paragraph, or between two: `... một chút a.      (2)`,
// `... đột đột lên. (19) Linh tỷ ...`. Only after a sentence's end (or spaces run on), and before
// a space or the line's end: in the middle of a sentence `(19)` is somebody's age. What follows it
// is the next paragraph, no title
const INLINE_NUMBER = /(?<=[.!?…。！？"”'’)\]】~*]\s*|\S\s{3,})[(（]\s*(?<n>\d{1,3})\s*[)）](?=\s|$)/gu;

// headings written into the middle of a line, which a line that opens with a heading
// of its own does not have: `(Chương 75: Xong, thỉnh mong chờ Chương 76: ...)` points at the
// next chapter, it does not begin it
function inlineHeadings(line: string, lineStart: number, ord: number) {
  let found: Candidate[] = [];
  for(let m of line.matchAll(INLINE_HEADING)) {
    if(!/\S/.test(line.slice(0, m.index))) continue;
    let rest = line.slice(m.index + m[0].length);
    let { n, word } = m.groups!;
    found.push(heading({
      kind: 'chap', n: Number(n), chapType: CHAPTER_WORDS[word.toLowerCase()],
      base: TUNING.base.inline, inline: true, text: m[0], rest, title: cleanTitle(rest).slice(0, TUNING.base.inlineTitleMax),
      shape: 'inline', index: lineStart + m.index, ord,
    }));
  }
  for(let m of line.matchAll(INLINE_NUMBER)) {
    found.push(heading({
      kind: 'chap', n: Number(m.groups!.n), base: TUNING.base.inline, inline: true, text: m[0], rest: line.slice(m.index + m[0].length), title: '',
      shape: 'inline()', index: lineStart + m.index, ord,
    }));
  }
  return found;
}

function findCandidates(text: string, name: string) {
  let lowerName = name.toLowerCase().normalize();
  let names = [...new Set([lowerName, lowerName.replace('hệ liệt', '').trim()])].filter(Boolean)
    .sort((a, z) => z.length - a.length);
  let nodes: Candidate[] = [];
  let ord = 0;
  let lineStart = 0;
  while(lineStart <= text.length) {
    let lineEnd = text.indexOf('\n', lineStart);
    if(lineEnd === -1) lineEnd = text.length;
    let line = text.slice(lineStart, lineEnd);
    if(/\S/.test(line)) {
      ord++;
      let lower = line.toLowerCase();
      let node = lower.length === line.length ? readHeading(line, lower, names) : null;
      if(node) nodes.push(heading({ ...node, index: lineStart + node.start, ord }));
      // (the heading a long line begins with is no surer than the ones in it, which are kept;
      // but the same heading as it, found again, is not)
      let opensWithHeading = node && !node.runsOn && node.base >= TUNING.path.breakMinBase;
      let inline = !opensWithHeading && line.length < 4000 ? inlineHeadings(line, lineStart, ord) : [];
      if(node?.runsOn) inline = inline.filter(other => other.n !== node.n || other.index - lineStart > HEADING_SAME_WITHIN);
      nodes.push(...inline);
    }
    lineStart = lineEnd + 1;
  }
  // one title line is the title page's own: it takes two for the file to hold books
  if(nodes.filter(node => node.bookName).length < 2) nodes = nodes.filter(node => !node.bookName);
  // a bracketed number run on behind a paragraph is a heading only in a book whose headings are
  // bracketed numbers, alone on their lines: elsewhere `(4)` is a note, and a few of them are
  // enough to string a book's sentences that begin `Một ...`, `Hai ...` into chapters
  if(nodes.filter(node => !node.inline && node.shape === 'L#R').length < TUNING.base.inlineNumbersAmong) {
    nodes = nodes.filter(node => node.shape !== 'inline()');
  }
  return nodes.sort((a, z) => a.index - z.index || a.ord - z.ord);
}

// ==== 4. The path ============================================================================
// What a path has reached by a node, and all the paths need to go on from it:
//   book    the book it is in, 0 when no book has been told apart
//   word    what the last book named was called (`Quyển`, `Bộ`, `Giai đoạn`), if any was
//   kind    the word of a book that numbers apart from the others (`Bộ 02` after the `Quyển`s),
//           null while the books are of the one kind
//   name    the name of a book that names itself and has no number (`Tên sách: ...`), until
//           a chapter numbers it (`Thứ 1 chương (bộ 02)`)
//   extra   whether that is the extras (phiên ngoại)
//   n       the chapter number it stands at (the last of a run)
//   half    the part of that chapter (thượng / trung / hạ), or null
//   ended   the book has had its last chapter
//   carry   the number the book before stopped at, which a book may go on from
type Reached = {
  book: number; word: string | null; kind: string | null; name: string | null; extra: boolean;
  n: number | null; half: number | null; ended: boolean; carry: number;
};
const reached = (node: Candidate, fields: Partial<Reached> = {}): Reached => ({
  book: node.bookNum ?? 0, word: node.bookType, kind: null, name: node.bookName, extra: !!node.extra, n: node.span ?? node.n ?? null, half: null, ended: false, carry: 0, ...fields,
});

// The best path through the headings, as a list of { i, joined, state }: the heading's place
// in `nodes`, whether it is the same heading as the one before (a repeat, or an end said
// twice), and what the path has reached by it.
// `credit` is how far each shape is trusted: shape -> -3..3. With `strongOnly` the nodes
// too weak for their shape stay out of the path altogether (see fillGaps)
type Step = { i: number; joined: boolean; state: Reached };
// the ways a heading is reached: from an earlier one (`go`), or as the start of a path (`begin`)
type Ways = {
  go: (from: number, value: number, as: Reached, joins?: boolean) => void;
  begin: (value: number, as: Reached, onlyIfAlone?: boolean) => void;
};
function chooseHeadings(nodes: Candidate[], credit: Record<string, number> = {}, strongOnly = false, excluded = new Set<number>()): Step[] {
  let score: number[] = new Array(nodes.length).fill(-Infinity);
  let prev: number[] = new Array(nodes.length).fill(-1);
  let joined: boolean[] = new Array(nodes.length).fill(false);
  let state: Reached[] = new Array(nodes.length);
  // earlier nodes by the number they ended on, to find the one a number follows
  let byNumber = new Map<number, number[]>();
  let bestByKey = new Map<string, number>();   // `${book}/${extra}` -> the best node that ended in that book
  let books: number[] = [];    // book and extra heading nodes seen
  let top = -1;                // the best path so far ends here

  let remember = (i: number) => {
    let { n, book, extra } = state[i];
    if(n != null) {
      if(!byNumber.has(n)) byNumber.set(n, []);
      byNumber.get(n)!.push(i);
    }
    let key = `${book}/${extra ? 1 : 0}`;
    if(!bestByKey.has(key) || score[i] > score[bestByKey.get(key)!]) bestByKey.set(key, i);
  };
  let apart = (i: number, j: number) => nodes[i].ord - nodes[j].ord;

  // the ways into a heading that has a number, `n`, one step each: going on from an earlier
  // number, from a book's heading, into a new book, off the numbers altogether, or
  // starting a path
  let goingOn = (i: number, n: number, { go }: Ways) => {
    let node = nodes[i];
    let { bookNum: book } = node;
    for(let d = 0; d <= TUNING.path.gapMax; d++) {
      for(let j of byNumber.get(n - d) ?? []) {
        let s = state[j];
        if(s.ended || (node.extra && !s.extra)) continue;
        if(book != null && s.book !== 0 && book !== s.book) continue;
        if(d === 0) {
          // the next part of the same chapter, or the same heading again
          if(node.half != null && (s.half == null || node.half > s.half)) go(j, TUNING.reward.next, { ...s, half: node.half });
          else if(apart(i, j) <= TUNING.path.closeLines && (s.half == null || node.half === s.half)) go(j, TUNING.reward.repeat, { ...s }, true);
        } else {
          go(j, TUNING.reward.next - TUNING.reward.gap * (d - 1), { ...s, n: node.span ?? n, book: book ?? s.book, word: node.bookType ?? s.word, name: book != null ? null : s.name, extra: s.extra || !!node.extra, half: node.half ?? null });
        }
      }
    }
  };

  // a book or an extra begins, and the numbers may start over
  let afterBookHeading = (i: number, n: number, { go }: Ways) => {
    let node = nodes[i];
    let { bookNum: book } = node;
    for(let j of books) {
      let s = state[j];
      // a bare number straight after `Kỳ Bạch Tuyết phiên ngoại` is the first of its extras
      let opensExtra = s.extra && !node.extra && apart(i, j) <= TUNING.path.opensExtraLines;
      if(s.extra !== !!node.extra && !opensExtra) continue;
      // a book that only names itself takes the number its first chapter gives it
      if(book != null && book !== s.book && !s.name) continue;
      let value = n <= TUNING.path.smallNumber ? TUNING.reward.boundary : (n === s.carry + 1 ? TUNING.reward.carryOn : TUNING.reward.boundary - TUNING.path.lateStartCost - Math.min(n, TUNING.path.lateStartCap));
      let numbered = book != null && { book, word: node.bookType ?? s.word, name: null };
      go(j, value, { ...s, n: node.span ?? n, half: node.half ?? null, ...numbered });
    }
  };

  // a book that names itself in the heading, or extras, with the numbers starting over
  let intoNewBook = (i: number, n: number, { go }: Ways) => {
    let node = nodes[i];
    let { bookNum: book } = node;
    if(n > TUNING.path.smallNumber || (book == null && !node.extra)) return;
    for(let j of bestByKey.values()) {
      let s = state[j];
      if(s.extra === !!node.extra && (book == null || book === s.book)) continue;
      go(j, TUNING.reward.boundary - 1, reached(node, { book: book ?? s.book, word: node.bookType ?? s.word, kind: s.kind, name: book == null ? s.name : null, carry: s.n ?? 0 }));
    }
  };

  // the numbers may break anywhere (a series that carries on from 101 after 47), at
  // a price that only a heading worth the price will pay
  let breakingOff = (i: number, n: number, { go }: Ways) => {
    let node = nodes[i];
    let { bookNum: book } = node;
    if(top < 0 || state[top].ended || node.base < TUNING.path.breakMinBase) return;
    let s = state[top];
    // the numbers start over inside a book that has been told apart from the others:
    // the next one began, whether or not it was named
    let unnamed = book == null && !node.extra && n <= TUNING.path.unnamedUpTo && s.book > 0 && (s.n ?? 0) >= TUNING.path.unnamedFrom;
    go(top, TUNING.reward.restart, { ...s, n: node.span ?? n, book: book ?? (unnamed ? s.book + 1 : s.book), word: node.bookType ?? s.word, name: book != null ? null : s.name, extra: !!node.extra, half: node.half ?? null, carry: s.n ?? 0 });
  };

  let startingHere = (i: number, n: number, { begin }: Ways) => {
    let node = nodes[i];
    let start = n <= TUNING.path.smallNumber ? TUNING.path.startAlone : TUNING.path.startFar;
    if(start > 0) begin(start, reached(node));
    else begin(start, reached(node), true);
  };

  // the ways into node i. Each calls `go(from, value, reached, joins)` for a way it
  // sees, and `begin(value, reached)` for a path that could start at the node itself
  let into: Record<'chap' | 'end' | 'book' | 'interlude' | 'half', (i: number, ways: Ways) => void> = {
    chap(i, ways) {
      let n = nodes[i].n;
      if(n == null) return;
      goingOn(i, n, ways);
      afterBookHeading(i, n, ways);
      intoNewBook(i, n, ways);
      breakingOff(i, n, ways);
      startingHere(i, n, ways);
    },
    // the last chapter: a repeat of the heading just before it, or the one after it
    end(i, { go }) {
      let node = nodes[i];
      let recent: number[] = [];
      for(let j = i - 1; j >= 0 && recent.length < TUNING.path.endLookback; j--) if(score[j] > -Infinity) recent.push(j);
      for(let j of recent) {
        let s = state[j];
        if(s.ended || s.n == null || s.extra !== !!node.extra) continue;
        if(apart(i, j) <= TUNING.path.closeLines) go(j, TUNING.reward.repeat + 1, { ...s, ended: true }, true);
        else if(s.n >= TUNING.path.endMin) go(j, TUNING.reward.end, { ...s, n: s.n + 1, ended: true });
      }
    },
    book(i, { go, begin }) {
      let node = nodes[i];
      let b = node.bookNum ?? 0;
      let extra = node.kind === 'extrahead' || !!node.extra;
      // a book that names itself and has no number is the next one, after whatever came
      if(node.bookName && node.bookNum == null) {
        for(let j of bestByKey.values()) go(j, 0, reached(node, { book: state[j].book + 1, carry: state[j].n ?? 0, n: null }));
        begin(TUNING.path.startAlone, reached(node, { book: 1, n: null }), books.length > 0);
        return;
      }
      for(let j of bestByKey.values()) {
        let s = state[j];
        // the next book, or one further on when a few were never named; or a book of another
        // kind, which numbers apart from the rest (`Bộ 02` after `Quyển 13`)
        let next = b > s.book || (b <= 2 && s.book === 0);
        let ofAnotherKind = !extra && !next && s.word != null && node.bookType != null && s.word !== node.bookType;
        let follows = extra ? !s.extra : (!s.extra && (next || ofAnotherKind));
        let skipped = extra || ofAnotherKind ? 0 : Math.max(0, b - s.book - 1);
        let kind = ofAnotherKind || (!extra && node.bookType != null && node.bookType === s.kind) ? node.bookType : null;
        if(follows) go(j, -Math.min(skipped, TUNING.path.skippedBooksMax), reached(node, { book: extra ? s.book : b, kind, extra, carry: s.n ?? 0, n: null }));
      }
      begin(TUNING.path.startAlone, reached(node, { book: extra ? 0 : b, extra, n: null }), books.length > 0);
    },
    // `Thứ 0 chương phiên ngoại`: a piece set between two chapters, outside their numbers
    interlude(_i, { go }) {
      if(top >= 0) go(top, TUNING.reward.interlude, { ...state[top] });
    },
    // the nearest heading before it that has a number gives the half its chapter
    half(i, { go }) {
      let node = nodes[i];
      for(let j = i - 1; j >= 0; j--) {
        if(score[j] === -Infinity) continue;
        let s = state[j];
        if(s.n == null || s.ended) continue;
        if(s.half == null || (node.half ?? 0) > s.half) go(j, TUNING.reward.half, { ...s, half: node.half });
        break;
      }
    },
  };

  for(let i = 0; i < nodes.length; i++) {
    let node = nodes[i];
    let prior = node.base + (credit[node.shape] ?? 0) - TUNING.path.threshold;
    if((strongOnly && prior < 0) || excluded.has(i)) continue;
    let best: { value: number; from: number; joined: boolean; as: Reached | null } = { value: -Infinity, from: -1, joined: false, as: null };
    let go = (j: number, value: number, as: Reached, joins = false) => {
      if(score[j] + value > best.value) best = { value: score[j] + value, from: j, joined: joins, as };
    };
    // a path starting here; unless `onlyIfAlone`, it competes with the ways into the node
    let begin = (value: number, as: Reached, onlyIfAlone = false) => {
      if(onlyIfAlone && best.value !== -Infinity) return;
      if(!(best.value > value)) best = { value, from: -1, joined: false, as };
    };
    let way: keyof typeof into | null = node.kind === 'chap' ? (node.end ? 'end' : node.n != null ? 'chap' : null)
      : node.kind === 'extrahead' ? 'book' : node.kind;
    if(way) into[way](i, { go, begin });
    if(best.value === -Infinity) continue;
    score[i] = best.value + prior;
    prev[i] = best.from;
    joined[i] = best.joined;
    state[i] = best.as!;
    // a piece in front of a book's first chapter (its preface, `Thứ 0 chương tự`) opens the
    // book as its heading does
    let opensBook = node.kind === 'interlude' && state[i].n == null;
    if(node.kind === 'book' || node.kind === 'extrahead' || opensBook) books.push(i);
    else remember(i);
    if(top < 0 || score[i] > score[top]) top = i;
  }

  let path: Step[] = [];
  for(let i = top; i >= 0; i = prev[i]) path.push({ i, joined: joined[i], state: state[i] });
  return path.reverse();
}

// A heading with a single line before the next is not a chapter of a book whose chapters
// run to dozens of lines: a list in the story (`Hồi 1: ...`, `Hồi 2: ...`) passes
// for a short chain the path is glad to take. The nodes of such a section are left out
function tinySections(nodes: Candidate[], path: Step[]) {
  let chapters = path.filter(({ i }) => nodes[i].kind === 'chap');
  let lengths = chapters.slice(1).map(({ i }, k) => nodes[i].ord - nodes[chapters[k].i].ord).sort((a, z) => a - z);
  let typical = lengths[Math.floor(lengths.length / 2)] ?? 0;
  let tiny = new Set<number>();
  // a book of one-paragraph chapters has nothing to tell a list from
  if(typical < TUNING.tiny.typicalAtLeast) return tiny;
  // (a heading its chapter's text runs on behind has a line or two however long the chapter: it
  // is told by how much text it holds)
  chapters.forEach(({ i }, k) => {
    let next = chapters[k + 1];
    let little = !nodes[i].runsOn || nodes[next?.i]?.index - nodes[i].index < TUNING.tiny.chars;
    if(next && !next.joined && little && nodes[next.i].ord - nodes[i].ord <= TUNING.tiny.lines) tiny.add(i);
  });
  return tiny;
}

// A contents list at the head of a book: a few headings close together (some with a few
// lines of notes under them), after which the book starts its numbers over and goes
// through them again. The entries are part of the title page, not chapters. Told by four
// things together: there are several entries (two sections in front of the first book,
// `Nhân vật giới thiệu`, are no list), the whole list is shorter than the chapter after
// it (or than a chapter usually is), the chapter after it starts again at the list's
// first number or lower, and every number the list names comes again later
function frontContents(nodes: Candidate[], path: Step[]) {
  let chapters = path.filter(({ i, joined }) => !joined && nodes[i].kind !== 'book' && nodes[i].kind !== 'extrahead');
  let lines = (k: number) => (chapters[k + 1] ? nodes[chapters[k + 1].i].ord : Infinity) - nodes[chapters[k].i].ord;
  let number = (k: number) => chapters[k].state.n;
  let lengths = chapters.slice(0, -1).map((_, k) => lines(k)).sort((a, z) => a - z);
  let typical = lengths[Math.floor(lengths.length / 2)] ?? 0;
  for(let k = Math.min(chapters.length - 1, TUNING.contents.maxEntries); k >= TUNING.contents.minEntries; k--) {
    let head = chapters.slice(0, k);
    let total = head.reduce((sum, _, j) => sum + lines(j), 0);
    if(total >= Math.max(lines(k), typical)) continue;
    let numbers = head.map((_, j) => number(j)).filter(n => n != null);
    // the numbers go back (the parts of one chapter, `Chương 44: (nhất)`, `(nhị)`, never do)
    let next = number(k);
    if(!numbers.length || next == null || next > Math.min(...numbers) || next >= Math.max(...numbers)) continue;
    let later = new Set(chapters.slice(k).map((_, j) => number(k + j)));
    if(numbers.every(n => later.has(n))) return new Set(head.map(({ i }) => i));
  }
  return new Set<number>();
}

// how far each shape is trusted, by how much of it landed on the path: -3 for one
// that never does, +3 for one that always does
function shapeCredit(nodes: Candidate[], path: Step[]) {
  let seen: Record<string, number> = {};
  let taken: Record<string, number> = {};
  for(let node of nodes) seen[node.shape] = (seen[node.shape] ?? 0) + 1;
  for(let { i } of path) taken[nodes[i].shape] = (taken[nodes[i].shape] ?? 0) + 1;
  let credit: Record<string, number> = {};
  for(let shape in seen) credit[shape] = TUNING.trust.scale * (((taken[shape] ?? 0) + 0.5) / (seen[shape] + 1) - 0.5);
  return credit;
}

// the headings the path left out because they are weak (a bare `Một ...` has little to
// say for itself) are taken back where they fill what is missing: chapter 6 between 5
// and 7, chapter 1 and 2 in front of a book's first heading, and nowhere else
function fillGaps(nodes: Candidate[], path: Step[], credit: Record<string, number>) {
  let weak: number[] = [];
  nodes.forEach((node, i) => {
    if(node.kind === 'chap' && node.n != null && node.base + (credit[node.shape] ?? 0) - TUNING.path.threshold < 0) weak.push(i);
  });
  let filled: Step[] = [];
  let fill = (from: number, to: number, first: number, last: number, state: Reached) => {
    // numbers first..last, in the order of the text between nodes `from` and `to`
    let at = from;
    for(let e = first; e <= last; e++) {
      let found: number | undefined;
      for(let i of weak) {
        if(i <= at || i >= to) continue;
        let node = nodes[i];
        if(node.n !== e || (node.extra && !state.extra)) continue;
        if(!found || node.base > nodes[found].base) found = i;
      }
      if(found != null) {
        filled.push({ i: found, joined: false, state: { ...state, n: e } });
        at = found;
      }
    }
  };
  let previous: { i: number; n: number; state: Reached } | undefined;     // the last chapter on the path
  let boundary = true;
  for(let entry of path) {
    let node = nodes[entry.i];
    if(node.kind === 'book' || node.kind === 'extrahead') { boundary = true; continue; }
    let n = entry.state.n;
    if(node.kind !== 'chap' || n == null || entry.joined) { continue; }
    if(previous && !boundary && entry.state.book === previous.state.book && entry.state.extra === previous.state.extra) {
      if(n > previous.n + 1) fill(previous.i, entry.i, previous.n + 1, n - 1, previous.state);
    } else if(n > 1 && n <= TUNING.fill.firstMax && !node.extra) {
      fill(previous?.i ?? -1, entry.i, 1, n - 1, { ...entry.state, n: 0 });
    }
    previous = { i: entry.i, n, state: entry.state };
    boundary = false;
  }
  return [...path, ...filled].sort((a, z) => a.i - z.i);
}

// ==== 5. Drafts ==============================================================================
const END_PHRASE = /^(chương\s+)?(kết|cuối)$/i;

// a title the heading itself carries, the plainest one when several headings stood together
// the title of a heading said twice: the one the surer of the two gives (`Thứ 6 chương · bị kẻ thù
// cấp lên!` over the book's name before `(06)` the line before), then the one that reads least
// like a sentence, and the longer
function pickTitle(members: Candidate[]) {
  let titled = members.filter(m => m.title && !END_PHRASE.test(m.title));
  titled.sort((a, z) => z.base - a.base || proseCost(a.title) - proseCost(z.title) || z.title.length - a.title.length);
  let titles = titled.map(m => m.title);
  // a paragraph that runs on behind the heading is not part of its title
  let title = titles[0];
  return title && title.length > TUNING.drafts.titleMax ? `${title.slice(0, TUNING.drafts.titleMax).replace(/\s+\S*$/, '')}…` : title;
}

function buildChapters(nodes: Candidate[], path: Step[]) {
  let clusters: { members: Candidate[]; state: Reached; index: number }[] = [];
  let opening: number | undefined;   // where the book heading in front of the next chapter begins
  for(let { i, joined, state } of path) {
    let node = nodes[i];
    if(node.kind === 'book' || node.kind === 'extrahead') {
      opening ??= node.index;
      continue;
    }
    let last = clusters.at(-1);
    if(joined && last) {
      last.members.push(node);
      last.state = state;
      continue;
    }
    clusters.push({ members: [node], state, index: Math.min(opening ?? Infinity, node.index) });
    opening = undefined;
  }
  // a book is `Quyển` or `Bộ` throughout, whichever the books' headings say most often, or
  // else the chapters that name their book (`Thứ 1 chương (bộ 02)`)
  let mostSaid = (words: (string | null)[]) => {
    let types: Record<string, number> = {};
    for(let word of words) if(word) types[word] = (types[word] ?? 0) + 1;
    return Object.keys(types).sort((a, z) => types[z] - types[a])[0];
  };
  let bookWord = mostSaid(path.map(({ i }) => nodes[i].kind === 'book' ? nodes[i].bookType : null))
    ?? mostSaid(path.map(({ i }) => nodes[i].bookNum != null ? nodes[i].bookType : null)) ?? 'Quyển';
  let drafts: Draft[] = [];
  let section: { name: string; type?: string } | undefined;    // the section whose parts are being listed
  for(let { members, state, index } of clusters) {
    let first = members[0];
    let lead = members.reduce((best, m) => m.base > best.base ? m : best, first);
    let end = members.find(m => m.end);
    let numbered = members.find(m => m.n != null && m.kind !== 'interlude');
    let type = members.find(m => m.chapType)?.chapType ?? (state.extra ? 'Phiên ngoại' : undefined);
    let heading: Heading = { type, title: pickTitle(members), text: lead.text };
    if(end) heading.number = end.endWord ?? undefined;
    else if(first.kind === 'half') {
      heading.number = String(state.n);
      heading.part = first.halfNum != null ? { text: `${first.halfType} ${first.halfNum}`, leading: true } : { text: first.halfText!, bracketed: first.halfBracketed };
    }
    else if(numbered) {
      heading.number = numbered.span != null ? `${numbered.n}-${numbered.span}` : String(numbered.n);
      if(numbered.half != null && numbered.kind === 'chap') heading.part = { text: numbered.halfText!, bracketed: numbered.halfBracketed };
    }
    // a part whose heading leaves out its section stays in the one before it
    let inherited = section && !lead.outer && state.book === 0 && type === section.type ? section.name : undefined;
    if(lead.outer) section = { name: lead.outer, type };
    else if(!inherited) section = undefined;
    let group = lead.outer ?? inherited ?? state.name ?? (state.book > 0 ? `${state.kind ?? bookWord} ${state.book}` : undefined);
    drafts.push({ offset: index, group, heading });
  }
  // a book that opens with no heading of its own, ahead of a `Bộ 2`, is the first
  let named = drafts.findIndex(d => d.group);
  if(named > 0) {
    let [, type, number] = /^(.*) (\d+)$/.exec(drafts[named].group!) ?? [];
    if(Number(number) === 2) {
      for(let d of drafts.slice(0, named)) d.group = `${type} 1`;
    }
  }
  return drafts;
}

// headings that carry no number but all begin with the same words and a dash, in
// order: `Quy tắc quái đàm — sân vận động...`, `Quy tắc quái đàm — dâm mỹ ký túc xá...`
function seriesChapters(text: string, { name }: { name: string }) {
  let lines: { key: string; index: number; line: string; length: number }[] = [];
  let start = 0;
  for(let line of text.split('\n')) {
    let found = line.length < 200 && /^\s*((?:\p{L}+ ){1,4}\p{L}+) ?[—–:-]/u.exec(line);
    if(found) lines.push({ key: found[1].toLowerCase(), index: start + line.search(/\S/), line: line.trim(), length: found[0].trim().length });
    start += line.length + 1;
  }
  let counts = new Map<string, number>();
  for(let { key } of lines) counts.set(key, (counts.get(key) ?? 0) + 1);
  // the words are the book's own title, or any dialogue that opens with a name and a
  // dash would pass for a heading
  let own = name.toLowerCase().normalize();
  let [key, count = 0] = [...counts].filter(([words]) => own.startsWith(words)).sort((a, z) => z[1] - a[1])[0] ?? [];
  if(!key || count < TUNING.drafts.seriesMin) return [];
  let drafts: Draft[] = [];
  for(let { key: lineKey, index, line, length } of lines) {
    if(lineKey !== key) continue;
    // what follows the repeated words, less the number that sometimes closes it
    let title = cleanTitle(line.slice(length)).replace(/\s*\(\s*\S{1,12}\s*\)\s*$/, '');
    drafts.push({ offset: index, heading: { number: String(drafts.length + 1), title, text: line } });
  }
  return drafts;
}

// a book with no headings to find is read in pages of this many paragraphs
function pagesOf(text: string, paragraphsPerPage = TUNING.drafts.pageParagraphs): Draft[] {
  let pattern = `(.*\n){1,${paragraphsPerPage}}`;
  return [...text.matchAll(new RegExp(pattern, 'gimu'))].map(m => ({ offset: m.index, heading: { text: m[0] } }));
}

// ==== 6. extractChapters =====================================================================
export function extractChapters(filename: string, text: string, { name }: { name: string }) {
  let nodes = findCandidates(text, name);
  // first take every node, to see which shapes the book writes its headings in
  let first = chooseHeadings(nodes);
  let credit = shapeCredit(nodes, first);
  let path = chooseHeadings(nodes, credit, true, tinySections(nodes, first));
  path = fillGaps(nodes, path, credit);
  let listed = frontContents(nodes, path);
  path = path.filter(({ i }) => !listed.has(i));
  let drafts = buildChapters(nodes, path);
  // no numbers to follow, but the same words begin every heading
  let series = seriesChapters(text, { name });
  if(series.length >= TUNING.drafts.seriesMin && series.length > drafts.length * TUNING.drafts.seriesOver) drafts = series;
  if(drafts.length < 2) drafts = pagesOf(text);
  return finishChapters(withPrologue(drafts, filename, text), text);
}

// no heading stands in front of the first one, so the title page, the author and
// the blurb fell outside every chapter and were never read. they open the book as
// an entry of their own
function withPrologue(drafts: Draft[], filename: string, text: string): Draft[] {
  let front = text.slice(0, drafts[0]?.offset ?? text.length).trim();
  if(!front) return drafts;
  return [{ offset: 0, heading: { title: filename, text: filename } }, ...drafts];
}

export function slug(text: string) {
  return latinize(text)
    .replace(/\W+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
}

export function latinize(source: string) {
  let s = source;
  s = s.replace(/[ÁĂẮẶẰẲẴǍÂẤẬẦẨẪÄǞȦǠẠȀÀẢȂĀĄÅǺḀȺÃⱯᴀ]/g, 'A');
  s = s.replace(/[Ꜳ]/g, 'AA');
  s = s.replace(/[ÆǼǢᴁ]/g, 'AE');
  s = s.replace(/[Ꜵ]/g, 'AO');
  s = s.replace(/[Ꜷ]/g, 'AU');
  s = s.replace(/[ꜸꜺ]/g, 'AV');
  s = s.replace(/[Ꜽ]/g, 'AY');
  s = s.replace(/[ḂḄƁḆɃƂʙᴃБ]/g, 'B');
  s = s.replace(/[ĆČÇḈĈĊƇȻꜾᴄ]/g, 'C');
  s = s.replace(/[ĎḐḒḊḌƊḎǲǅĐÐƋꝹᴅД]/g, 'D');
  s = s.replace(/[ǱǄ]/g, 'DZ');
  s = s.replace(/[ÉĔĚȨḜÊẾỆỀỂỄḘËĖẸȄÈẺȆĒḖḔĘɆẼḚƐƎᴇⱻЕЭ]/g, 'E');
  s = s.replace(/[Ꝫ]/g, 'ET');
  s = s.replace(/[ḞƑꝻꜰФ]/g, 'F');
  s = s.replace(/[ǴĞǦĢĜĠƓḠǤꝽɢʛГҐ]/g, 'G');
  s = s.replace(/[ḪȞḨĤⱧḦḢḤĦʜХ]/g, 'H');
  s = s.replace(/[ÍĬǏÎÏḮİỊȈÌỈȊĪĮƗĨḬІɪЙЫИ]/g, 'I');
  s = s.replace(/[ꞂŔŘŖṘṚṜȐȒṞɌⱤʁʀᴙᴚР]/g, 'R');
  s = s.replace(/[ꞄŚṤŠṦŞŜȘṠṢṨꜱС]/g, 'S');
  s = s.replace(/[ꞆŤŢṰȚȾṪṬƬṮƮŦᴛТ]/g, 'T');
  s = s.replace(/[Ꝭ]/g, 'IS');
  s = s.replace(/[ĴɈᴊ]/g, 'J');
  s = s.replace(/[ḰǨĶⱩꝂḲƘḴꝀꝄᴋК]/g, 'K');
  s = s.replace(/[ĹȽĽĻḼḶḸⱠꝈḺĿⱢǈŁꞀʟᴌЛ]/g, 'L');
  s = s.replace(/[Ǉ]/g, 'LJ');
  s = s.replace(/[ḾṀṂⱮƜᴍМ]/g, 'M');
  s = s.replace(/[ŃŇŅṊṄṆǸƝṈȠǋÑɴᴎН]/g, 'N');
  s = s.replace(/[Ǌ]/g, 'NJ');
  s = s.replace(/[ÓŎǑÔỐỘỒỔỖÖȪȮȰỌŐȌÒỎƠỚỢỜỞỠȎꝊꝌŌṒṐƟǪǬØǾÕṌṎȬƆᴏᴐО]/g, 'O');
  s = s.replace(/[Ƣ]/g, 'OI');
  s = s.replace(/[Ꝏ]/g, 'OO');
  s = s.replace(/[Ȣᴕ]/g, 'OU');
  s = s.replace(/[ṔṖꝒƤꝔⱣꝐᴘП]/g, 'P');
  s = s.replace(/[ꝘꝖ]/g, 'Q');
  s = s.replace(/[ß]/g, 'ss');
  s = s.replace(/[ɅꝞṾƲṼᴠВ]/g, 'V');
  s = s.replace(/[Ꜩ]/g, 'TZ');
  s = s.replace(/[ÚŬǓÛṶÜǗǙǛǕṲỤŰȔÙỦƯỨỰỪỬỮȖŪṺŲŮŨṸṴᴜУ]/g, 'U');
  s = s.replace(/[Ꝡ]/g, 'VY');
  s = s.replace(/[ẂŴẄẆẈẀⱲᴡ]/g, 'W');
  s = s.replace(/[ẌẊ]/g, 'X');
  s = s.replace(/[ÝŶŸẎỴỲƳỶỾȲɎỸʏ]/g, 'Y');
  s = s.replace(/[Ї]/g, 'YI');
  s = s.replace(/[ŹŽẐⱫŻẒȤẔƵᴢЗ]/g, 'Z');
  s = s.replace(/[Þ]/g, 'TH');
  s = s.replace(/[Ĳ]/g, 'IJ');
  s = s.replace(/[Œɶ]/g, 'OE');
  s = s.replace(/[áăắặằẳẵǎâấậầẩẫäǟȧǡạȁàảȃāąᶏẚåǻḁⱥãɐₐАа]/g, 'a');
  s = s.replace(/[ꜳ]/g, 'aa');
  s = s.replace(/[æǽǣᴂ]/g, 'ae');
  s = s.replace(/[ꜵ]/g, 'ao');
  s = s.replace(/[ꜷ]/g, 'au');
  s = s.replace(/[ꜹꜻ]/g, 'av');
  s = s.replace(/[ꜽ]/g, 'ay');
  s = s.replace(/[ḃḅɓḇᵬᶀƀƃб]/g, 'b');
  s = s.replace(/[ɵóŏǒôốộồổỗöȫȯȱọőȍòỏơớợờởỡȏꝋꝍⱺōṓṑǫǭøǿõṍṏȭɔᶗᴑᴓₒо]/g, 'o');
  s = s.replace(/[ćčçḉĉɕċƈȼↄꜿ]/g, 'c');
  s = s.replace(/[ďḑḓȡḋḍɗᶑḏᵭᶁđɖƌðꝺд]/g, 'd');
  s = s.replace(/[ıíĭǐîïḯịȉìỉȋīįᶖɨĩḭіᴉᵢйыи]/g, 'i');
  s = s.replace(/[ȷɟʄǰĵʝɉⱼ]/g, 'j');
  s = s.replace(/[ǳǆ]/g, 'dz');
  s = s.replace(/[éĕěȩḝêếệềểễḙëėẹȅèẻȇēḗḕⱸęᶒɇẽḛɛᶓɘǝₑеэ]/g, 'e');
  s = s.replace(/[ꝫ]/g, 'et');
  s = s.replace(/[ḟƒᵮᶂꝼф]/g, 'f');
  s = s.replace(/[ǵğǧģĝġɠḡᶃǥᵹɡᵷгґ]/g, 'g');
  s = s.replace(/[ḫȟḩĥⱨḧḣḥɦẖħɥʮʯх]/g, 'h');
  s = s.replace(/[ƕ]/g, 'hv');
  s = s.replace(/[ꞃŕřŗṙṛṝȑɾᵳȓṟɼᵲᶉɍɽɿɹɻɺⱹᵣр]/g, 'r');
  s = s.replace(/[ꞅſẜẛẝśṥšṧşŝșṡṣṩʂᵴᶊȿс]/g, 's');
  s = s.replace(/[ꞇťţṱțȶẗⱦṫṭƭṯᵵƫʈŧʇт]/g, 't');
  s = s.replace(/[ꝭ]/g, 'is');
  s = s.replace(/[ḱǩķⱪꝃḳƙḵᶄꝁꝅʞк]/g, 'k');
  s = s.replace(/[ĺƚɬľļḽȴḷḹⱡꝉḻŀɫᶅɭłꞁл]/g, 'l');
  s = s.replace(/[ǉ]/g, 'lj');
  s = s.replace(/[ḿṁṃɱᵯᶆɯɰм]/g, 'm');
  s = s.replace(/[ńňņṋȵṅṇǹɲṉƞᵰᶇɳñн]/g, 'n');
  s = s.replace(/[ǌ]/g, 'nj');
  s = s.replace(/[ƣ]/g, 'oi');
  s = s.replace(/[ꝏ]/g, 'oo');
  s = s.replace(/[ȣ]/g, 'ou');
  s = s.replace(/[ṕṗꝓƥᵱᶈꝕᵽꝑп]/g, 'p');
  s = s.replace(/[ꝙʠɋꝗ]/g, 'q');
  s = s.replace(/[ᴝúŭǔûṷüǘǚǜǖṳụűȕùủưứựừửữȗūṻųᶙůũṹṵᵤу]/g, 'u');
  s = s.replace(/[ᵺþ]/g, 'th');
  s = s.replace(/[ᴔœ]/g, 'oe');
  s = s.replace(/[ʌⱴꝟṿʋᶌⱱṽᵥв]/g, 'v');
  s = s.replace(/[ʍẃŵẅẇẉẁⱳẘ]/g, 'w');
  s = s.replace(/[ʎýŷÿẏỵỳƴỷỿȳẙɏỹ]/g, 'y');
  s = s.replace(/[ꜩ]/g, 'tz');
  s = s.replace(/[ᵫ]/g, 'ue');
  s = s.replace(/[ꝸ]/g, 'um');
  s = s.replace(/[ꝡ]/g, 'vy');
  s = s.replace(/[ẍẋᶍₓ]/g, 'x');
  s = s.replace(/[ї]/g, 'yi');
  s = s.replace(/[źžẑʑⱬżẓȥẕᵶᶎʐƶɀз]/g, 'z');
  s = s.replace(/[ﬀ]/g, 'ff');
  s = s.replace(/[ﬃ]/g, 'ffi');
  s = s.replace(/[ﬄ]/g, 'ffl');
  s = s.replace(/[ﬁ]/g, 'fi');
  s = s.replace(/[ﬂ]/g, 'fl');
  s = s.replace(/[ĳ]/g, 'ij');
  s = s.replace(/[ﬆ]/g, 'st');
  s = s.replace(/[Ё]/g, 'YO');
  s = s.replace(/[Ц]/g, 'TS');
  s = s.replace(/[Ш]/g, 'SH');
  s = s.replace(/[Щ]/g, 'SCH');
  s = s.replace(/[ЪъЬь]/g, '\'');
  s = s.replace(/[ё]/g, 'yo');
  s = s.replace(/[ц]/g, 'ts');
  s = s.replace(/[ш]/g, 'sh');
  s = s.replace(/[щ]/g, 'sch');
  s = s.replace(/[Ж]/g, 'ZH');
  s = s.replace(/[ж]/g, 'zh');
  s = s.replace(/[Я]/g, 'Ya');
  s = s.replace(/[Ч]/g, 'CH');
  s = s.replace(/[Ю]/g, 'YU');
  s = s.replace(/[я]/g, 'ya');
  s = s.replace(/[ч]/g, 'ch');
  s = s.replace(/[ю]/g, 'yu');
  return s;
}
