// How a name is told in the text, without the page: the patterns the page colours names by
// (names.ts), and the names a book's text gives most often, which the server keeps of each
// book for search (server/read-worker.ts).

// how a reader is likely to have somebody addressed. The doubled and compound
// ones stand on their own in the text, so they are worth detecting; a bare
// `nương` is the everyday word far more often, and is only ever added by hand
export const standaloneRelationships = [
  'cô cô', 'thúc thúc', 'bá bá', 'thẩm thẩm', 'nhạc phụ', 'nhạc mẫu', 'bá phụ',
  'bá mẫu', 'tiểu di', 'ca ca', 'tỷ tỷ', 'muội muội', 'lão bà', 'lão công',
  'phụ thân', 'mẫu thân',
];

// what somebody is called by behind their name: `Liễu di`, `Mộ Dung tỷ tỷ`. Such a name is
// somebody of the list called so, and the add button offers who
export const addressedBy = [
  'ba ba', 'ba', 'mụ mụ', 'mẹ', 'thúc', 'di', 'ca ca', 'ca', 'tỷ tỷ', 'tỷ', 'tổng', 'lang', 'nô',
  'bá bá', 'bá', 'bá phụ', 'bá mẫu', 'đại tỷ', 'đại ca', 'lão bà',
];

// patterns with named holes in them: `{Word}` is filled from `placeholders`, each fill a group
// of its own name, so the holes can be filled within each other
export function buildRegex(patterns: (RegExp | string | false | null | undefined)[], placeholders: Record<string, RegExp>, flags?: string) {
  let source = patterns.filter((p): p is RegExp | string => !!p).map((p, i) => `(?<Case${i + 1}>${typeof p === 'string' ? p : p.source})`).join('|');
  let counts: Record<string, number> = Object.fromEntries(Object.keys(placeholders).map(k => [k, 0]));
  for(let i = 1; i <= 10; i++) {
    for(let [p, r] of Object.entries(placeholders)) {
      source = source.replaceAll(`{${p}}`, () => `(?<${p}${++counts[p]}>${r.source})`);
    }
  }
  return new RegExp(source, flags);
}

export const namePlaceholders = {
  wb: /^|$|(?<=[^\p{L}])|(?=[^\p{L}])/u,
  Upper: /\p{Lu}/u,
  Lower: /\p{Ll}/u,
  Word: /{wb}{Upper}{Lower}*{wb}/,
  NameBegin: /(?<!^|[.:"'!?()[\]] ?|{Word} )/,
};
// names by descending confidence: the general patterns, then the ones that hang on a
// lowercase prefix like `a Tô`. The tiers are scanned apart on purpose - in one regex `a Tô`
// would consume the start of `Tô Diễm` and the real name would never even be collected
export const namePatterns = [
  [
    /{NameBegin}{Word}(\s{Word}){1,3}/,
    `{NameBegin}({Word} )?{Word} (${[...addressedBy].sort((a, z) => z.length - a.length).join('|')}){wb}`,
    new RegExp(standaloneRelationships.join('|')),
  ],
  [
    /{wb}a {Word}(?!{Word})/,
    /(tiểu|lão) {Word}(?!{wb}{Word})( tử)?/,
  ],
];
export const nameRegexes = () => namePatterns.map(patterns => buildRegex(patterns, namePlaceholders, 'gu'));

// A sentence's first word is capitalized whatever it is, so the patterns above take nothing from
// where one opens. Two capitalized words there and then a lowercase one (`Lâm Phong cười`) are
// still a name, when the text opens with them again and again: once may be a capitalized word
// and whatever follows it, `least` times is somebody the sentences are about
const OPENING = /(?:^|[.:"'!?()[\]“”…]\s*)(\p{Lu}\p{Ll}* \p{Lu}\p{Ll}*)(?= \p{Ll})/gu;
export function openingNames(texts: string[], least = 2) {
  let found = new Map<string, string[]>();   // lowercased -> each time it opens a sentence, as written
  for(let text of texts) {
    for(let match of text.matchAll(OPENING)) {
      let key = match[1].toLowerCase();
      (found.get(key) ?? found.set(key, []).get(key)!).push(match[1]);
    }
  }
  return [...found.values()].filter(times => times.length >= least);
}

// The names a text gives, and how often, for the server to keep of each book: what the
// patterns above take for a name, told by a faster way, since it reads whole libraries. Two to
// four capitalized words that do not open a sentence (a sentence's first word is capitalized
// whatever it is), or a single one behind `a`, `tiểu` or `lão`. Not those the text opens with
// often (see openingNames): the page marks these names in every chapter of the book (see
// findMarks in marks.ts), and across a whole book they are mostly a word and a name, `Mà Lạc`.
// Each is written the way it is written most, counted however it is cased, and a name of three
// or four words also counts as its last two, the way it is usually shortened. Only what is said
// `least` times or more, the `most` said first
const CAPITALIZED = /(?<![\p{L}\p{N}])\p{Lu}\p{Ll}*(?: \p{Lu}\p{Ll}*){1,3}(?![\p{L}\p{N}])/gu;
const ADDRESSED = /(?<![\p{L}\p{N}])(?:a|tiểu|lão) \p{Lu}\p{Ll}*(?![\p{L}\p{N}]| \p{Lu})/gu;
const OPENS_SENTENCE = /(?:^|[.:"'!?()[\]“”…])\s*$/u;
export function findNames(text: string, { least = 3, most = 200 } = {}) {
  let found = new Map<string, { spellings: Map<string, number>; count: number }>();   // lowercased -> how it is written, and how often
  let count = (name: string) => {
    let key = name.toLowerCase();
    let entry = found.get(key) ?? found.set(key, { spellings: new Map(), count: 0 }).get(key)!;
    entry.count++;
    entry.spellings.set(name, (entry.spellings.get(name) ?? 0) + 1);
  };
  for(let line of text.split('\n')) {
    for(let match of line.matchAll(CAPITALIZED)) {
      if(OPENS_SENTENCE.test(line.slice(Math.max(0, match.index - 3), match.index))) continue;
      count(match[0]);
      let words = match[0].split(' ');
      if(words.length === 3 || words.length === 4) count(`${words.at(-2)} ${words.at(-1)}`);
    }
    for(let match of line.matchAll(ADDRESSED)) count(match[0]);
  }
  return [...found.values()]
    .filter(entry => entry.count >= least)
    .sort((a, z) => z.count - a.count)
    .slice(0, most)
    .map(({ spellings, count: mentions }) => ({ name: [...spellings].sort((a, z) => z[1] - a[1])[0][0], mentions }));
}
