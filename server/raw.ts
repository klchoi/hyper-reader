// A book's text as its file has it, which the index is kept to: whatever the parser makes of it
// (normalizeFileContent in src/parser.ts, which may change any time), the index stays. Only the
// Unicode form is made one (NFC), which is a standard, and does not change.
export const rawText = (source: string) => source.normalize();

// letters and digits a chapter is found by in the file's text: its heading and the words after
// it, or, where the parser took some of those out, its heading alone
const ANCHORS = [48, 12];
const WORD = /[\p{L}\p{N}]/gu;
// whether a character is a letter or a digit, each asked once
let words = new Map<string, boolean>();
const isWord = (ch: string) => words.get(ch) ?? words.set(ch, /^[\p{L}\p{N}]$/u.test(ch)).get(ch)!;

// where in `raw`, from `from` and before `to`, the letters are, whatever is between them
function find(raw: string, letters: string[], from: number, to: number) {
  for(let at = raw.indexOf(letters[0], from); at >= 0 && at < to; at = raw.indexOf(letters[0], at + 1)) {
    let k = 1;
    for(let i = at + letters[0].length; k < letters.length && i < raw.length;) {
      let ch = String.fromCodePoint(raw.codePointAt(i)!);
      if(ch === letters[k]) k++;
      else if(isWord(ch)) break;
      i += ch.length;
    }
    if(k === letters.length) return at;
  }
  return -1;
}

// where each place of the text as the parser reads it (`text`) is in the file's text (`raw`), for
// the beginnings of chapters, in order: each found by its first letters and digits (what the
// parser does to a text is mostly to its spaces, lines and punctuation), after the one before
// and not far past where it should be; one not found is put between those found, in proportion
export function rawOffsets(raw: string, text: string, offsets: number[]) {
  let ratio = raw.length / Math.max(1, text.length);
  let found: (number | null)[] = [];
  let from = 0;
  let fromText = 0;
  for(let offset of offsets) {
    if(offset <= 0) {
      found.push(0);
      continue;
    }
    let letters = text.slice(offset, offset + ANCHORS[0] * 8).match(WORD) ?? [];
    let to = from + Math.ceil((offset - fromText) * ratio * 1.5) + 65536;
    let at = -1;
    for(let anchor of ANCHORS) {
      if(letters.length < 4) break;
      at = find(raw, letters.slice(0, anchor), from, to);
      if(at >= 0) break;
    }
    if(at < 0) {
      found.push(null);
      continue;
    }
    found.push(at);
    from = at + 1;
    fromText = offset;
  }
  // those not found, in proportion between their neighbours found
  return found.map((at, n) => {
    if(at != null) return at;
    let before = n - 1;
    while(before >= 0 && found[before] == null) before--;
    let after = n + 1;
    while(after < found.length && found[after] == null) after++;
    let [b, bText] = before >= 0 ? [found[before]!, offsets[before]] : [0, 0];
    let [a, aText] = after < found.length ? [found[after]!, offsets[after]] : [raw.length, text.length];
    return Math.round(b + (offsets[n] - bText) * (a - b) / Math.max(1, aText - bText));
  });
}
