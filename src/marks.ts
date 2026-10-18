// The names in a book's text, as its list has them (one person to a line, see names.ts): the text
// corrected by the list, and where the names stand in it, those of the list and those the
// patterns find (name-patterns.ts), each with the person it is of. Nothing of the page: the
// server marks a chapter before it sends it, so the page only colours where it is told
// (names.ts), and marks one itself only while the list is edited.
import { addressedBy, buildRegex, nameRegexes, namePatterns, standaloneRelationships } from './name-patterns.ts';

// ---- words and their case -----------------------------------------------------------
export function titleCase(s: string) {
  return s.toLowerCase().replace(/(?<=^|[^\p{L}])./gu, c => c.toUpperCase());
}

export function getCase(word: string) {
  if (word === word.toUpperCase()) return 'upper';
  if (word === word.toLowerCase()) return 'lower';
  if (word[0] === word[0].toUpperCase()) return 'title';
}

function toCase(word: string, wanted?: string) {
  if (wanted === 'upper') return word.toUpperCase();
  if (wanted === 'lower') return word.toLowerCase();
  if (wanted === 'title') return titleCase(word);
  return word;
}

// what `src` is rewritten as: a word for word rewrite keeps the case each word was found in
// (a function of what was found), anything else is written as it was asked for
let cases = new Map<string, string | ((s: string) => string)>();
function useCase(src: string, dst: string) {
  let key = `${src}\u0000${dst}`;
  if (!cases.has(key)) cases.set(key, caseOf(src, dst));
  return cases.get(key)!;
}
function caseOf(src: string, dst: string): string | ((s: string) => string) {
  if (getCase(src) === 'lower' && getCase(dst) === 'lower') return titleCase(dst);
  let srcWords = src.split(' ');
  let dstWords = dst.split(' ');
  if (srcWords.length !== dstWords.length) return dst;
  let kept = srcWords.map((srcWord, i) => (getCase(srcWord) !== getCase(dstWords[i]) ? getCase(dstWords[i]) : undefined));
  return (s: string) => s.split(' ').map((word, i) => toCase(dstWords[i], kept[i] || getCase(word))).join(' ');
}

let hashes = new Map<string, number>();
export function hashCode(str: string) {
  if (hashes.has(str)) return hashes.get(str)!;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  hashes.set(str, hash);
  return hash;
}

export const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

// ---- the list of names ----------------------------------------------------------------
// a translation often leaves the plain Vietnamese word where the name wants the
// Sino-Vietnamese one: `Công Tôn ngày` for `Công Tôn Thiên`. First word of each
// group is the one a name is written with, the rest are what to also look for
const nameWordGroups = [
  ['vũ', 'mưa'],
  ['khinh', 'nhẹ'],
  ['vân', 'mây'],
  ['nhan', 'mặt'],
  ['thiên', 'ngày'],
];
const nameWords: Record<string, string> = Object.fromEntries(nameWordGroups.flatMap(([nameWord, ...others]) => (
  others.map(other => [other, nameWord])
)));
const mapNameWords = (name: string) => name.split(' ')
  .map(word => toCase(nameWords[word.toLowerCase()] || word, getCase(word)))
  .join(' ');
// match a listed name however its words were translated. only for names of two
// words or more: on its own `ngày` is the everyday word far more often than a name
function nameWordPattern(name: string) {
  // a name is text to look for, never a pattern: the half-typed `Giản Ninh (lão`
  // of a relationship being written would otherwise leave a group unterminated
  name = escapeRegExp(name);
  if (!name.trim().includes(' ')) return name;
  return name.replace(/\p{L}+/gu, word => {
    let group = nameWordGroups.find(g => g.includes(word.toLowerCase()));
    return group ? `(?:${group.join('|')})` : word;
  });
}
// `(đại ca)` is what somebody is called, not what they are named: it takes the
// person's color wherever it shows up, but the text keeps the case it is written
// in - `đại ca` is a word of the sentence, and titling it would read as a name.
// It can stand on its own or trail the name it belongs to, `Giản Ninh (lão bà)`
export function splitRelationship(entry: string): { name: string; relationship?: string } {
  let [, name, relationship] = entry.trim().match(/^(.*?)\s*\((.*)\)$/) || [];
  if (relationship === undefined) return { name: entry.trim() };
  return { name, relationship: relationship.trim() };
}
const relationshipWords = new Set([...standaloneRelationships, 'nương']);
export const isRelationship = (name: string) => relationshipWords.has(name.trim().toLowerCase());
// whichever side of a `from -> to` entry the text ends up reading
const entryTarget = (entry: string) => entry.split(/->|→/).at(-1)!.trim();
// a relationship renamed in the text is still a word of the sentence, so the
// new wording is written the way the old one was: `Lão bà` opening a sentence
// comes back as `Bà xã`, mid-sentence as `bà xã`, and a shout stays a shout
function followCase(src: string, dst: string) {
  let found = getCase(src.trim().split(/\s+/)[0]);
  if (found === 'upper') return dst.toUpperCase();
  if (found === 'title') return dst[0].toUpperCase() + dst.slice(1).toLowerCase();
  return dst.toLowerCase();
}
// what a person is, said on their line: `[m]`, `[f]`, or `[m→f]` and `[f→m]` for somebody living
// as the other (`->` will do for the arrow), anywhere on it. Only shown beside their name: nothing
// of the text is changed by it, and no name is made of it
export type Gender = 'm' | 'f' | 'm→f' | 'f→m';
export const GENDERS: Gender[] = ['m', 'f', 'm→f', 'f→m'];
export const genderSymbols: Record<Gender, string> = { 'm': '♂', 'f': '♀', 'm→f': '♂→♀', 'f→m': '♀→♂' };
export const genderNames: Record<Gender, string> = { 'm': 'male', 'f': 'female', 'm→f': 'trans woman (m→f)', 'f→m': 'trans man (f→m)' };
const genderTag = /\s*\[\s*([mf])\s*(?:(?:->|→)\s*([mf])\s*)?\]/giu;
// the line's tag, the last where it gives two
function genderOf(line: string): Gender | undefined {
  let tag = [...line.matchAll(genderTag)].at(-1);
  if (!tag) return;
  let from = tag[1].toLowerCase(), to = tag[2]?.toLowerCase();
  return (to && to !== from ? `${from}→${to}` : from) as Gender;
}
export const withoutGender = (text: string) => text.replace(genderTag, '');

// the name a `from -> to` entry ends up written as in the text, which is what
// the highlighter has to look for: anything else and the edit reads as detected
function editedName(entry: string) {
  let [from, to] = entry.split(/->|→/).map(n => n?.trim());
  let written: string | ((s: string) => string);
  if (to === undefined) {
    from = entry;
    written = titleCase(entry);
  } else {
    written = useCase(from, to);
  }
  if (typeof written === 'function') written = written(from);
  return written && mapNameWords(written);
}

// The text with its names corrected by the list: made once for a list, used on every text.
// Every name on the same line is the same person, so each one still gets corrected on its own;
// `aliasOf` in highlightNames is what ties them together. The names of an entry are corrected,
// and a `(relationship)` only where it is renamed outright. A relationship is a word of the
// sentence, not somebody's name: listing it plain only says who it is said of - the text keeps
// it exactly as written and the highlighter colors it where it stands. `lão bà -> bà xã` asks
// for the wording itself to change, and that is worth doing, in the case the text wrote it in
// rather than the one the list is typed in
let fixer = { names: null as string | null, fix: (text: string) => text };
export function nameFixer(names: string | undefined): (text: string) => string {
  if (!names) return text => text;
  if (fixer.names === names) return fixer.fix;
  let entries = withoutGender(names).split(/[\n,]/).flatMap(entry => {
    let { name, relationship } = splitRelationship(entry);
    return [
      name && { text: name, relationship: false },
      relationship && /->|→/.test(relationship) && { text: relationship, relationship: true },
    ].filter(Boolean) as { text: string; relationship: boolean }[];
  });
  // add short name automatically
  for (let { text, relationship } of entries) {
    if (relationship || /->|→/.test(text)) continue;
    let words = text.split(/\s/);
    if (words.length === 3 || words.length === 4) entries.push({ text: `${words.at(-2)} ${words.at(-1)}`, relationship: false });
  }
  let steps: [RegExp, (name: string) => string][] = [];
  for (let { text, relationship } of entries) {
    text = text.trim();
    if (!text) continue;
    let [from, to] = text.split(/->|→/).map(n => n?.trim());
    let written: string | ((name: string) => string);
    if (to === undefined) {
      from = text;
      written = titleCase(text);
    } else if (relationship) {
      let wording = to;
      written = (name) => followCase(name, wording);
    } else {
      written = useCase(from, to);
    }
    if (!from) continue;
    let fromRegex = new RegExp(`(?<=^|[^\\p{L}])${nameWordPattern(from)}(?=[^\\p{L}]|$)`, 'gui');
    steps.push([fromRegex, name => mapNameWords(typeof written === 'function' ? written(name) : written)]);
  }
  let fix = (content: string) => steps.reduce((text, [regex, replace]) => text.replaceAll(regex, replace), content);
  fixer = { names, fix };
  return fix;
}

export const shortNameId = (nameId: string) => {
  let words = nameId.trim().split(/\s+/);
  if (words.length === 3 || words.length === 4) return words.slice(-2).join(' ');
};
// every name the editor already knows about, one id per entry
const nameIdsOf = (names: string) => withoutGender(names || '').split(/[\n,]/)
  .flatMap(entry => Object.values(splitRelationship(entry)) as string[])
  .map(entry => entryTarget(entry).toLowerCase())
  .filter(Boolean);
// one entry per line of the editor, in the same order, so a line can be found
// again by what it holds. Every name on a line is the same person and the first
// one names them; the auto short name rides along with the name it comes from.
// A `(relationship)` on the line is theirs too, kept apart from their names
// because it is not one: nothing is derived from it and nothing binds to it. So is
// what they are (`[f]`), which is no name either
export function listedNames(names: string) {
  return (names || '').split('\n').map(line => {
    let lineNames: string[] = [];
    let relationships: string[] = [];
    for (let entry of withoutGender(line).split(',')) {
      let { name, relationship } = splitRelationship(entry);
      if (relationship) relationships.push(entryTarget(relationship));
      if (!name) continue;
      let hasArrow = /->|→/.test(name);
      let to = editedName(name);
      // a lowercase entry is a wording fix, not a name to highlight
      if (!to || getCase(to) === 'lower') continue;
      lineNames.push(to);
      // add short name automatically
      let shortName = hasArrow ? undefined : shortNameId(to);
      if (shortName) lineNames.push(shortName);
    }
    return { names: lineNames, relationships, gender: genderOf(line) };
  });
}
const nameWordsOf = (name: string) => name.toLowerCase().split(/\s+/).filter(Boolean);
// `tiểu`, `lão` and `a` name nobody, they are how somebody is addressed - the
// same words namePatterns detects a name behind. What is left of `Tiểu Lôi Tử`
// or `Lôi Nhi` once they are gone is the `Lôi` the name is really made of
const honorificPrefixes = ['a', 'tiểu', 'lão'];
function plainNameWords(words: string[]) {
  let prefixed = words.length > 1 && honorificPrefixes.includes(words[0]);
  if (prefixed) words = words.slice(1);
  // `nhi` is a fond form of any name, `tử` only ever tags along with a prefix:
  // on its own `Khổng Tử` is a whole name, not a `Khổng` being addressed
  let suffixes = prefixed ? ['nhi', 'tử'] : ['nhi'];
  if (words.length > 1 && suffixes.includes(words.at(-1)!)) return words.slice(0, -1);
  // and `Liễu di` is a `Liễu` called by what she is
  let called = addressedBy.map(nameWordsOf).filter(by => by.length < words.length && by.every((word, i) => words.at(i - by.length) === word));
  let longest = Math.max(0, ...called.map(by => by.length));
  return words.slice(0, words.length - longest);
}
// `Lôi Lôi` and `Tiểu Lôi` are nobody new, they are what somebody calls
// `Lục Nguyệt Lôi`: every word they are written with is a word of the full name.
// The suffix merge in highlightNames only catches the names that *end* the same
// way, so these are offered as a row on the add button - guessed at, never assumed
export function aliasCandidates(names: string, name: string) {
  let words = plainNameWords(nameWordsOf(name));
  let nameId = name.toLowerCase();
  let candidates: { canonical: string; onLastWord: boolean; length: number }[] = [];
  for (let { names: lineNames } of listedNames(names)) {
    if (!lineNames.length) continue;
    // already this person's name, there is nothing left to bind
    if (lineNames.some(listed => listed.toLowerCase() === nameId)) return [];
    let derivedFrom = lineNames
      .map(nameWordsOf)
      .filter(listedWords => words.every(word => listedWords.includes(word)));
    if (!derivedFrom.length) continue;
    candidates.push({
      // the first name on the line is the one that names the person
      canonical: lineNames[0],
      // a nickname is made from the end of a name far more often than its start
      onLastWord: derivedFrom.some(listedWords => words.includes(listedWords.at(-1)!)),
      length: Math.min(...derivedFrom.map(listedWords => listedWords.length)),
    });
  }
  return candidates
    .sort((a, z) => Number(!a.onLastWord) - Number(!z.onLastWord) || a.length - z.length)
    .slice(0, 3)
    .map(candidate => candidate.canonical);
}
// `ca ca` belongs to whoever the paragraph was talking about, and the nearest
// name before it is the best guess there is: `Lôi Nhi nhìn ca ca` is his, not
// that of the person named three sentences ago. Offered as rows, never assumed
export function kinCandidates(names: string, before: string) {
  if (!before) return [];
  let candidates: { canonical: string; at: number }[] = [];
  for (let { names: lineNames } of listedNames(names)) {
    if (!lineNames.length) continue;
    let at = Math.max(...lineNames.map(name => before.toLowerCase().lastIndexOf(name.toLowerCase())));
    if (at >= 0) candidates.push({ canonical: lineNames[0], at });
  }
  return candidates
    .sort((a, z) => z.at - a.at)
    .slice(0, 3)
    .map(candidate => candidate.canonical);
}

// The list with a name added, or null when it is not to be added: already there, or the line
// it was to join is gone. `alias` is the person this name belongs to: it joins their line
// instead of starting one of its own, which is what puts them in the same color group.
// `(a relationship)` is written in lower case whatever the text called it: the parens are what
// the reader edits, the case in there would only be noise
export function namesWith(names: string, { name, alias, relationship }: { name: string; alias?: string; relationship?: boolean }) {
  names = (names || '').trim();
  if (nameIdsOf(names).includes(name.toLowerCase())) return null;
  let entry = relationship ? `(${name.toLowerCase()})` : name;
  if (!alias) return `${names ? `${names}\n` : ''}${entry}\n`;
  let lines = names.split('\n');
  let line = listedNames(names).findIndex(({ names: lineNames }) => lineNames[0] === alias);
  // the list was edited out from under the button, don't guess where to put it
  if (line < 0) return null;
  lines[line] = `${lines[line].trimEnd()}, ${entry}`;
  return `${lines.join('\n')}\n`;
}

// The list with what `person` (the first name of their line) is said to be, or no longer said to
// be; null when their line is gone
export function namesWithGender(names: string, person: string, gender?: Gender) {
  names = (names || '').trim();
  let lines = names.split('\n');
  let line = listedNames(names).findIndex(({ names: lineNames }) => lineNames[0] === person);
  if (line < 0) return null;
  lines[line] = `${withoutGender(lines[line]).trimEnd()}${gender ? ` [${gender}]` : ''}`;
  return `${lines.join('\n')}\n`;
}

// the person of the list a name is one of the names of, and what they are said to be
export function listedPerson(names: string, name: string) {
  let id = name.toLowerCase();
  let found = listedNames(names).find(({ names: lineNames }) => lineNames.some(listed => listed.toLowerCase() === id));
  return found && { name: found.names[0], gender: found.gender };
}

// ---- a chapter as the page shows it -----------------------------------------------------------
// a line of a chapter: its text, and the offset it begins at in the book (in the text as read, so a
// place in it is the same whatever the list corrects)
export type Line = { text: string; offset: number };
export const lineSeparator = /\n|<\/?\w+>/gi;
export function linesOf({ content, offset }: { content: string; offset: number }, fix: (text: string) => string): Line[] {
  let fixed = fix(content).split(lineSeparator);
  let lines: Line[] = [];
  let at = 0;
  for (let m of content.matchAll(lineSeparator)) {
    lines.push({ text: content.slice(at, m.index), offset: offset + at });
    at = m.index + m[0].length;
  }
  lines.push({ text: content.slice(at), offset: offset + at });
  // a correction that split or joined a line would shift every line after it
  if (fixed.length === lines.length) for (let [i, line] of lines.entries()) line.text = fixed[i];
  return lines;
}

// A name found in one of some texts (`at`), from `start` to `end`: the person it is of, and whether
// the list has it (one that it has not is offered to be added). A person is known by the first name
// the list gives them, or by the longest name they were found by; `persons` gives every name each
// goes by here, the short names (the last two words of three or four) they would go by, and what
// the list says they are
export type Mark = { at: number; start: number; end: number; person: string; known: boolean };
export type Persons = Record<string, { ids: string[]; short: string[]; gender?: Gender }>;
export type Marked = { lines: Line[]; marks: Mark[]; persons: Persons };

// the people of the list: every name and relationship it gives, the person each points back to,
// and what each person is said to be
export function listedPeople(names: string) {
  let known: string[] = [];
  let aliasOf = new Map<string, string>();
  let genders = new Map<string, Gender>();
  for (let { names: lineNames, relationships, gender } of listedNames(names)) {
    known.push(...lineNames, ...relationships);
    // the first name on the line names the person, the rest point back to it - a relationship
    // never names them, it only ever points back
    let [canonicalId, ...aliasIds] = [...lineNames, ...relationships].map(name => name.toLowerCase());
    if (canonicalId && gender && !genders.has(canonicalId)) genders.set(canonicalId, gender);
    for (let aliasId of aliasIds) {
      if (aliasId !== canonicalId && !aliasOf.has(aliasId)) aliasOf.set(aliasId, canonicalId);
    }
  }
  return { known, aliasOf, genders };
}

const wordBound = { wb: /^|$|(?<=[^\p{L}])|(?=[^\p{L}])/u };
// the regex that finds any of `names`, the longer first
export const anyOf = (names: string[]) => buildRegex([`{wb}(${[...names].sort((a, z) => z.length - a.length).map(escapeRegExp).join('|')}){wb}`], wordBound, 'gui');

export function findMarks(texts: string[], names: string): { marks: Mark[]; persons: Persons } {
  let { known, aliasOf, genders } = listedPeople(names);
  let knownIds = new Set(known.map(name => name.toLowerCase()));
  // collect names, by descending confidence: what the list says, then the patterns (see
  // name-patterns.ts), each tier scanned apart. The list's own names need no collecting, they are
  // already the whole tier
  let tiers: string[][] = [known, ...namePatterns.map(() => [] as string[])];
  let seen = new Set(knownIds);
  let collect = (tier: number, name: string) => {
    let nameId = name.toLowerCase();
    // whatever a better tier already claims stays there
    if (seen.has(nameId)) return;
    seen.add(nameId);
    tiers[tier].push(name);
  };
  let collectRegexes = nameRegexes();
  for (let text of texts) {
    collectRegexes.forEach((nameRegex, index) => {
      for (let match of text.matchAll(nameRegex)) {
        collect(index + 1, match[0]);
        let words = match[0].split(/\s/);
        if (words.length === 3 || words.length === 4) collect(index + 1, `${words.at(-2)} ${words.at(-1)}`);
      }
    });
  }
  // an empty alternation below would match the empty string everywhere
  if (!tiers.some(tier => tier.length)) return { marks: [], persons: {} };
  let tierRegexes = tiers.map(tier => tier.length > 0 && anyOf(tier));
  let found: { at: number; start: number; end: number; nameId: string; known: boolean }[] = [];
  texts.forEach((text, at) => {
    let matches: { tier: number; name: string; start: number; end: number }[] = [];
    tierRegexes.forEach((nameRegex, tier) => {
      if (!nameRegex) return;
      for (let match of text.matchAll(nameRegex)) matches.push({ tier, name: match[0], start: match.index, end: match.index + match[0].length });
    });
    // a name from the list wins over a pattern, and a longer name over a shorter one; anything
    // overlapping what is already taken is dropped, so a prefix loses to the real name inside it
    // no matter which starts first
    matches.sort((a, z) => (a.tier - z.tier) || (z.name.length - a.name.length) || (a.start - z.start));
    let taken: { start: number; end: number }[] = [];
    for (let { name, start, end } of matches) {
      if (taken.some(other => start < other.end && other.start < end)) continue;
      taken.push({ start, end });
      let nameId = name.toLowerCase();
      found.push({ at, start, end, nameId, known: knownIds.has(nameId) });
    }
  });
  // a name found that ends another found (`Tiêu Dao` of `Lý Tiêu Dao`) is that person, unless the
  // list says whose it is
  let ids = [...new Set(found.map(f => f.nameId))];
  let longestFirst = [...ids].sort((a, z) => z.length - a.length);
  let kept = new Set(ids);
  let ownerOf = new Map<string, string>();
  let aliases = new Map<string, string[]>();
  for (let id of ids) {
    if (aliasOf.has(id)) continue;
    let full = longestFirst.find(other => other.endsWith(` ${id}`));
    if (!full || !kept.has(full)) continue;
    kept.delete(id);
    ownerOf.set(id, full);
    aliases.set(full, [...(aliases.get(full) ?? [full]), id]);
  }
  // one person to a line of the list: the names it gives share their person
  let personOf = (id: string) => {
    let owner = ownerOf.get(id) ?? id;
    return aliasOf.get(owner) || owner;
  };
  let persons: Persons = {};
  for (let id of kept) {
    let person = personOf(id);
    (persons[person] ??= { ids: [], short: [] }).ids.push(...(aliases.get(id) ?? [id]));
  }
  // a short name the list gave to somebody else is not this person's
  for (let [person, { ids: names, short }] of Object.entries(persons)) {
    short.push(...names.map(shortNameId).filter((id): id is string => !!id && !names.includes(id) && (aliasOf.get(id) || person) === person));
    let gender = genders.get(person);
    if (gender) persons[person].gender = gender;
  }
  return { marks: found.map(({ at, start, end, nameId, known: isKnown }) => ({ at, start, end, person: personOf(nameId), known: isKnown })), persons };
}

// a chapter as the page shows it: its lines as the list corrects them, and the names in them
export function markChapter(chapter: { content: string; offset: number }, names: string): Marked {
  let lines = linesOf(chapter, nameFixer(names));
  return { lines, ...findMarks(lines.map(line => line.text), names) };
}

// what the list says a person is, put beside each of their names in the chapter: where in which
// line (the index of its lines), the first place in it first
export type Said = { end: number; gender: Gender; person: string };
export function genderSaid(chapter: Marked | null | undefined) {
  let said = new Map<number, Said[]>();
  if (!chapter) return said;
  for (let mark of [...chapter.marks].sort((a, z) => (a.at - z.at) || (a.start - z.start))) {
    let gender = chapter.persons[mark.person]?.gender;
    if (!gender) continue;
    (said.get(mark.at) ?? said.set(mark.at, []).get(mark.at)!).push({ end: mark.end, gender, person: mark.person });
  }
  return said;
}
// a line's pieces (see places.ts) cut where what a person is goes in
type Piece = string | { href: string };
export function piecesSaying(pieces: Piece[], said: Said[]): (Piece | Said)[] {
  let shown: (Piece | Said)[] = [];
  let left = [...said];
  let at = 0;
  for (let piece of pieces) {
    if (typeof piece !== 'string') {
      shown.push(piece);
      at += piece.href.length;
      continue;
    }
    let from = 0;
    while (left.length && left[0].end <= at + piece.length) {
      let cut = Math.max(left[0].end - at, from);
      if (cut > from) shown.push(piece.slice(from, cut));
      shown.push(left.shift()!);
      from = cut;
    }
    if (from < piece.length) shown.push(piece.slice(from));
    at += piece.length;
  }
  return [...shown, ...left];
}
