// The names in a book: the list the reader keeps of them (one person to a line), the text
// corrected by it, and the names coloured where they stand on the page, those still missing
// from the list underlined, to be added with a click.
import chromaJs from 'chroma-js';
import { nextTick } from './places.ts';
import { buildRegex, nameRegexes, namePatterns, standaloneRelationships } from './name-patterns.ts';

// ---- words and their case -----------------------------------------------------------
export function titleCase(s: string) {
  return s.toLowerCase().replace(/(?<=^|[^\p{L}])./gu, c => c.toUpperCase());
}

function getCase(word: string) {
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

const escapeRegExp = (s: string) => s.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');

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
function splitRelationship(entry: string): { name: string; relationship?: string } {
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
  let entries = names.split(/[\n,]/).flatMap(entry => {
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

const shortNameId = (nameId: string) => {
  let words = nameId.trim().split(/\s+/);
  if (words.length === 3 || words.length === 4) return words.slice(-2).join(' ');
};
// every name the editor already knows about, one id per entry
const nameIdsOf = (names: string) => (names || '').split(/[\n,]/)
  .flatMap(entry => Object.values(splitRelationship(entry)) as string[])
  .map(entry => entryTarget(entry).toLowerCase())
  .filter(Boolean);
// one entry per line of the editor, in the same order, so a line can be found
// again by what it holds. Every name on a line is the same person and the first
// one names them; the auto short name rides along with the name it comes from.
// A `(relationship)` on the line is theirs too, kept apart from their names
// because it is not one: nothing is derived from it and nothing binds to it
function listedNames(names: string) {
  return (names || '').split('\n').map(line => {
    let lineNames: string[] = [];
    let relationships: string[] = [];
    for (let entry of line.split(',')) {
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
    return { names: lineNames, relationships };
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
  if (words.length > 1 && suffixes.includes(words.at(-1)!)) words = words.slice(0, -1);
  return words;
}
// `Lôi Lôi` and `Tiểu Lôi` are nobody new, they are what somebody calls
// `Lục Nguyệt Lôi`: every word they are written with is a word of the full name.
// The suffix merge in highlightNames only catches the names that *end* the same
// way, so these are offered as a row on the add button - guessed at, never assumed
function aliasCandidates(names: string, name: string) {
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
function kinCandidates(names: string, before: string) {
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

// ---- colours ----------------------------------------------------------------------------
// hue per name id, kept for the whole session: the same character can show up
// as `Lý Tiêu Dao` in one chapter and only as `Tiêu Dao` in the next, so
// hashing whichever id survives the merge below would recolor them mid-book
const nameHues = new Map<string, number>();
// degrees around the wheel are not what the eye measures - 30 of them through the
// blues barely change the colour, where 30 through the reds are a different one - so
// a name is kept a distance from the others in what is actually seen. It starts on
// the hue its name hashes to, which is what makes the colour its own and the same
// one every time, and walks on only far enough to stop looking like somebody else
const nameDeltaE = 20;
// the hue is judged at one fixed lightness, not on the paper in front of us: a
// character keeps the hue they were given when the theme changes, so choosing it
// against the paper of the moment would only space the cast for the theme it
// happened to be assigned under, and crowd them on every other one. Being fixed, it is
// worked out once a hue
const spacingColors = new Map<number, chromaJs.Color>();
function spacingColor(hue: number) {
  let color = spacingColors.get(hue);
  if (!color) spacingColors.set(hue, color = spacingColorOf(hue));
  return color;
}
function spacingColorOf(hue: number) {
  for (let c = 110; c >= 25; c -= 5) {
    let color = chromaJs.hcl(hue, c, 60);
    if (!color.clipped()) return color;
  }
  return chromaJs.hcl(hue, 25, 60);
}
function spacedHue(seed: number) {
  let hue = ((seed % 360) + 360) % 360;
  let taken = [...new Set(nameHues.values())].map(spacingColor);
  if (!taken.length) return hue;
  let best = { hue, distance: -1 };
  for (let step = 0; step < 360; step += 5) {
    let candidate = (hue + step) % 360;
    let color = spacingColor(candidate);
    let distance = Math.min(...taken.map(c => chromaJs.deltaE(color, c)));
    if (distance >= nameDeltaE) return candidate;
    if (distance > best.distance) best = { hue: candidate, distance };
  }
  // the cast is bigger than the wheel has room for; take the least alike there is
  return best.hue;
}
// the colour is read off the page it will sit on, so both the paper and the prose
// are asked for rather than assumed. The prose is taken as it is painted and not as
// it is written: the gray theme sets its text in white at 78%, and a name has to
// differ from what is on the paper, not from what was asked for
function paperColor() {
  let paper = getComputedStyle(document.body).getPropertyValue('--paper-background-color').trim();
  try { return chromaJs(paper || '#fff'); } catch { return chromaJs('#fff'); }
}
function proseColor(paper: chromaJs.Color) {
  try {
    let prose = chromaJs(getComputedStyle(document.body).color);
    return prose.alpha() < 1 ? chromaJs.mix(paper, prose, prose.alpha(), 'rgb') : prose;
  } catch {
    return paper.luminance() < 0.4 ? chromaJs('#fff') : chromaJs('#000');
  }
}
// the most colour a hue will carry at a lightness, which is wherever sRGB runs out.
// Asking past that clips, and clipped colours come out both muddy and alike
function mostChroma(hue: number, l: number) {
  for (let c = 132; c > 0; c -= 2) {
    let color = chromaJs.hcl(hue, c, l);
    if (!color.clipped()) return { color, chroma: c };
  }
  return { color: chromaJs.hcl(hue, 0, l), chroma: 0 };
}
// being readable on the paper was only half of it. A name also has to be told from
// the sentence it is standing in, and on a page of near-black prose every colour is
// the lighter mark and so the weaker one - what is left to say `name` with is how
// much colour it carries. So the lightness is not settled first: every lightness the
// paper will take is tried and the most colourful one wins, which is what stopping at
// the lightest readable one was quietly giving up. A floor against the prose itself
// keeps a hue from landing on the very colour the words are written in
const nameContrast = 4.5;
const proseDeltaE = 15;
// a few thousand colors tried for each name, and the next chapter names the same people on
// the same paper: each is worked out once, a hue and a theme
const nameColors = new Map<string, chromaJs.Color>();
function nameColor(hue: number, paper: chromaJs.Color, prose: chromaJs.Color) {
  let key = `${hue} ${paper.hex()} ${prose.hex()}`;
  let color = nameColors.get(key);
  if (!color) nameColors.set(key, color = nameColorOf(hue, paper, prose));
  return color;
}
function nameColorOf(hue: number, paper: chromaJs.Color, prose: chromaJs.Color) {
  let best, readable;
  for (let l = 20; l <= 96; l += 2) {
    let found = mostChroma(hue, l);
    if (chromaJs.contrast(found.color, paper) < nameContrast) continue;
    if (!readable || found.chroma > readable.chroma) readable = found;
    if (chromaJs.deltaE(found.color, prose) < proseDeltaE) continue;
    if (!best || found.chroma > best.chroma) best = found;
  }
  // a hue with nowhere to stand on this paper: being read beats being colourful
  return (best || readable || { color: prose }).color;
}

// ---- names on the page ------------------------------------------------------------------
type Found = { range: Range; name: string; known: boolean };
// scope prefix -> (text node -> the names found in it), for hit testing the pointer
const detectedNames: Record<string, Map<Node, Found[]>> = {};

// the article and the command palette are highlighted independently, each pass
// owning its own style ids, so one can be refreshed without redoing the other
export type Scope = { selector: string; prefix: string };
export const articleNames: Scope = { selector: 'article p, nav a .name', prefix: 'hl' };
export const commandPaletteNames: Scope = { selector: '#command-palette a', prefix: 'cp' };

// the colors of a pass, one stylesheet to a scope, holding the rules of the names it colored
// and no others. Every rule is checked on every style recalculation, whether or not its
// highlight is still there: the rules of the chapters read before would pile up, and slow down
// every chapter opened after them
function setHighlightStyles(prefix: string, rules: string[]) {
  let styleEl = document.head.querySelector(`style[name="${prefix}"]`);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('name', prefix);
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = rules.join('\n');
}

export async function highlightNames(names: string, { selector, prefix }: Scope = articleNames) {
  await nextTick();

  // a copy of the names: the loop deletes from what it walks
  for (let styleId of Array.from(CSS.highlights.keys())) {
    if (styleId.startsWith(`${prefix}-`)) CSS.highlights.delete(styleId);
  }
  setHighlightStyles(prefix, []);
  detectedNames[prefix] = new Map();
  let paper = paperColor();
  let prose = proseColor(paper);

  // names from editor
  let knowNames: string[] = [];
  let aliasOf = new Map<string, string>();
  for (let { names: lineNames, relationships } of listedNames(names)) {
    knowNames.push(...lineNames, ...relationships);
    // the first name on the line names the person, the rest point back to it -
    // a relationship never names them, it only ever points back
    let [canonicalId, ...aliasIds] = [...lineNames, ...relationships].map(name => name.toLowerCase());
    for (let aliasId of aliasIds) {
      if (aliasId !== canonicalId && !aliasOf.has(aliasId)) aliasOf.set(aliasId, canonicalId);
    }
  }

  let knowNameIds = new Set(knowNames.map(name => name.toLowerCase()));

  // collect names, by descending confidence: what the editor says, then the patterns
  // (see name-patterns.ts), each tier scanned apart
  // the editor's own names need no collecting, they are already the whole tier
  let tiers: string[][] = [knowNames, ...namePatterns.map(() => [] as string[])];
  let seen = new Set(knowNameIds);
  let collect = (tier: number, name: string) => {
    let nameId = name.toLowerCase();
    // whatever a better tier already claims stays there
    if (seen.has(nameId)) return;
    seen.add(nameId);
    tiers[tier].push(name);
  };
  let textNodes = [...document.querySelectorAll(selector)].flatMap(el => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE));
  let collectRegexes = nameRegexes();
  for (let node of textNodes) {
    collectRegexes.forEach((nameRegex, index) => {
      for (let match of node.textContent!.matchAll(nameRegex)) {
        collect(index + 1, match[0]);
        let words = match[0].split(/\s/);
        if (words.length === 3 || words.length === 4) collect(index + 1, `${words.at(-2)} ${words.at(-1)}`);
      }
    });
  }
  tiers = tiers.map(tier => tier.sort((a, z) => z.length - a.length));
  // an empty alternation below would match the empty string everywhere
  if (!tiers.some(tier => tier.length)) return;

  // create ranges;
  let tierRegexes = tiers.map(tier => tier.length > 0 && buildRegex([
    `{wb}(${tier.map(escapeRegExp).join('|')}){wb}`,
  ], { wb: /^|$|(?<=[^\p{L}])|(?=[^\p{L}])/u }, 'gui'));
  let ranges: Record<string, Found[]> = {};
  for (let node of textNodes) {
    let matches: { tier: number; name: string; start: number; end: number }[] = [];
    tierRegexes.forEach((nameRegex, tier) => {
      if (!nameRegex) return;
      for (let match of node.textContent!.matchAll(nameRegex)) {
        matches.push({ tier, name: match[0], start: match.index, end: match.index + match[0].length });
      }
    });
    // a name from the editor wins over a pattern, and a longer name over a
    // shorter one; anything overlapping what is already taken is dropped, so a
    // prefix loses to the real name inside it no matter which starts first
    matches.sort((a, z) => (a.tier - z.tier) || (z.name.length - a.name.length) || (a.start - z.start));

    let taken: { start: number; end: number }[] = [];
    for (let { name, start, end } of matches) {
      if (taken.some(other => start < other.end && other.start < end)) continue;
      taken.push({ start, end });

      let range = new Range();
      range.setStart(node, start);
      range.setEnd(node, end);
      let nameId = name.toLowerCase();
      let found = { range, name, known: knowNameIds.has(nameId) };
      (ranges[nameId] ??= []).push(found);
      // only names still missing from the list are worth pointing at
      if (!found.known) {
        if (!detectedNames[prefix].has(node)) detectedNames[prefix].set(node, []);
        detectedNames[prefix].get(node)!.push(found);
      }
    }
  }

  // merge sub ranges
  let nameIds = Object.keys(ranges).sort((a, z) => z.length - a.length);
  let aliases: Record<string, string[]> = {};
  for (let nameId in ranges) {
    // an explicit alias already says who this is, don't guess from the suffix
    if (aliasOf.has(nameId)) continue;
    let fullNameId = nameIds.find(id => id.endsWith(` ${nameId}`));
    if (fullNameId && ranges[fullNameId]) {
      ranges[fullNameId].push(...ranges[nameId]);
      (aliases[fullNameId] ??= [fullNameId]).push(nameId);
      delete ranges[nameId];
    }
  }

  // one group per person: names the editor lists on the same line share a key,
  // which is also the key their hue is remembered under
  let groups: Record<string, { ids: string[]; ranges: Found[] }> = {};
  for (let nameId in ranges) {
    let groupId = aliasOf.get(nameId) || nameId;
    groups[groupId] ??= { ids: [], ranges: [] };
    groups[groupId].ids.push(...(aliases[nameId] || [nameId]));
    groups[groupId].ranges.push(...ranges[nameId]);
  }

  let rules: string[] = [];
  for (let groupId in groups) {
    // reuse the hue of any id this character is already known by, including the
    // short name derived from a full one, so it stays the same across chapters
    let { ids, ranges: groupRanges } = groups[groupId];
    // a short name the editor gave to somebody else is not this person's
    let shortIds = ids.map(shortNameId)
      .filter((id): id is string => !!id && !ids.includes(id) && (aliasOf.get(id) || groupId) === groupId);
    let hue = [groupId, ...ids, ...shortIds].map(id => nameHues.get(id)).find(h => h !== undefined);
    if (hue === undefined) hue = spacedHue(hashCode(groupId));
    for (let id of [groupId, ...ids]) nameHues.set(id, hue);
    for (let id of shortIds) if (!nameHues.has(id)) nameHues.set(id, hue);

    let color = nameColor(hue, paper, prose);
    // keyed by name, not by hue: distinct names do collide on a hue, and
    // CSS.highlights.set would then drop one of their highlights entirely
    let styleId = `${prefix}-${(hashCode(groupId) >>> 0).toString(36)}`;
    // a name already in the list only gets its color, one still missing from it
    // also gets a dashed underline, so it reads as something to click
    for (let [suffix, known] of [['', true], ['-new', false]] as const) {
      let found = groupRanges.filter(f => f.known === known);
      if (!found.length) continue;
      CSS.highlights.set(styleId + suffix, new Highlight(...found.map(f => f.range)));
      rules.push(`::highlight(${styleId + suffix}) { ${[
        `color: ${color} !important;`,
        known ? '' : 'text-decoration: underline 1px dashed !important; text-underline-offset: 0.3em; text-decoration-skip-ink: none;',
      ].join(' ')} }`);
    }
  }
  setHighlightStyles(prefix, rules);
}

// ---- adding a name from the page ----------------------------------------------------------
export type AddNameAt = { name: string; before: string; top: number; left: number };
export type AddNameOffer = AddNameAt & { relationship: boolean; aliases: string[] };

const isWordChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}]/u.test(char);
// a partially selected word counts as the whole word
export function wholeWords(range: Range) {
  range = range.cloneRange();
  let { startContainer, endContainer } = range;
  if (startContainer.nodeType === Node.TEXT_NODE) {
    let text = startContainer.textContent!;
    // only when the selection really starts inside a word, not next to one
    while (isWordChar(text[range.startOffset]) && isWordChar(text[range.startOffset - 1])) {
      range.setStart(startContainer, range.startOffset - 1);
    }
  }
  if (endContainer.nodeType === Node.TEXT_NODE) {
    let text = endContainer.textContent!;
    while (isWordChar(text[range.endOffset - 1]) && isWordChar(text[range.endOffset])) {
      range.setEnd(endContainer, range.endOffset + 1);
    }
  }
  return range;
}
export function asName(range: Range) {
  let name = range.toString()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if (name.length > 80 || !/\p{L}/u.test(name)) return;
  return name;
}
// where to float the button: centered on top of what it would add, but always
// far enough inside the viewport to stay clickable. a name wrapped over two
// lines has one rect per line, and their union spans the whole column, so
// anchor to the line the pointer is on instead of to the union
export function addNameAt(range: Range, name: string, x?: number, y?: number): AddNameAt | undefined {
  let rects = [...range.getClientRects()].filter(rect => rect.width || rect.height);
  if (!rects.length) return;
  // vertical distance first: the pointer sits between two lines far more often
  // than it sits past the end of the one it is on
  let distance = (rect: DOMRect) => Math.max(rect.top - y!, y! - rect.bottom, 0) * 1e4 + Math.max(rect.left - x!, x! - rect.right, 0);
  let rect = y === undefined ? rects[0] : rects.reduce((best, r) => (distance(r) < distance(best) ? r : best));
  return {
    name,
    // the paragraph up to here, as far as the text node it starts in reaches
    before: range.startContainer.nodeType === Node.TEXT_NODE
      ? range.startContainer.textContent!.slice(0, range.startOffset)
      : '',
    top: Math.round(Math.max(rect.top, 30)),
    left: Math.round(Math.min(Math.max(rect.left + rect.width / 2, 60), innerWidth - 60)),
  };
}
// who this name could be: a relationship belongs to whoever was named last before it, a name
// to whoever it is made from
export function offerFor(names: string, at: AddNameAt): AddNameOffer {
  let relationship = isRelationship(at.name);
  return {
    ...at,
    relationship,
    // a relationship shares no word with a name, so who it belongs to can only
    // come from the text: whoever was last named before it was said
    aliases: relationship ? kinCandidates(names, at.before) : aliasCandidates(names, at.name),
  };
}
function caretAt(x: number, y: number) {
  let position = document.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  let range = document.caretRangeFromPoint?.(x, y);
  if (range) return { node: range.startContainer, offset: range.startOffset };
}
export function detectedNameAt(x: number, y: number) {
  let caret = caretAt(x, y);
  if (!caret) return;
  for (let byNode of Object.values(detectedNames)) {
    let found = (byNode.get(caret.node) || []).find(({ range }) => (
      caret.offset >= range.startOffset && caret.offset <= range.endOffset
      && [...range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
    ));
    if (found) return found;
  }
}
