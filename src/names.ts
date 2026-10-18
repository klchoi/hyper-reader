// The names on the page, in colour: where the backend found them in the chapter (see marks.ts), and
// in the titles of the chapter list and of the palette; those still missing from the list
// underlined, to be added with a click.
import chromaJs from 'chroma-js';
import { tick } from 'ripple';
import { getColorScheme, nextTick } from './places.ts';
import { aliasCandidates, anyOf, hashCode, isRelationship, kinCandidates, listedPeople, listedPerson } from './marks.ts';
import type { Gender, Marked, Persons } from './marks.ts';

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
// The hues a name is coloured in: as many as a page can tell apart, each a highlight of its own (see
// paint). More would only cost: every highlight is matched against every element of the page each
// time its style is worked out, and a chapter of a hundred people, a highlight each, took seconds
// to on a phone. People that share a hue share a highlight
const HUES = 24;
const HUE_STEP = 360 / HUES;
function spacedHue(seed: number) {
  let hue = (Math.round((((seed % 360) + 360) % 360) / HUE_STEP) % HUES) * HUE_STEP;
  let taken = [...new Set(nameHues.values())].map(spacingColor);
  if (!taken.length) return hue;
  let best = { hue, distance: -1 };
  for (let step = 0; step < 360; step += HUE_STEP) {
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
// both, read once a theme: asking for a style has the browser work out the whole page's there and
// then, the chapter just put in it too, and once more when it is painted
let themed: { key: string; paper: chromaJs.Color; prose: chromaJs.Color } | undefined;
function themeColors() {
  let root = document.documentElement;
  let key = `${getColorScheme()} ${root.getAttribute('data-color:light')} ${root.getAttribute('data-color:dark')}`;
  if (themed?.key !== key) {
    let paper = paperColor();
    themed = { key, paper, prose: proseColor(paper) };
  }
  return themed;
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
// scope -> (text node -> the names found in it still missing from the list), for the pointer
const detectedNames: Record<string, Map<Node, Found[]>> = {};

// the chapter, the chapter list and the palette are coloured apart, each with highlights (and a
// stylesheet) of its own, so one can be painted again without the others
export type Scope = 'hl' | 'nl' | 'cp';

// the colors of a pass, one stylesheet to a scope, holding the rules of the names it colored
// and no others. A rule is checked on every element it selects each time the page's style is
// worked out, whether or not its highlight is still there: the rules of the chapters read before
// would pile up, and slow down every chapter opened after them. So a rule selects only the
// elements that hold its names, which say so (`data-names`): a highlight for every element took
// a chapter list of a thousand titles ten times as long
function setHighlightStyles(prefix: string, rules: string[]) {
  let styleEl = document.head.querySelector(`style[name="${prefix}"]`);
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('name', prefix);
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = rules.join('\n');
}

// the hue a person is coloured in, kept for the session under every name they go by: the same
// character shows up as `Lý Tiêu Dao` in one chapter and only as `Tiêu Dao` in the next, and the
// short name of a full one goes with it, unless it is already somebody's
function hueOf(person: string, { ids, short }: { ids: string[]; short: string[] }) {
  let hue = [person, ...ids, ...short].map(id => nameHues.get(id)).find(h => h !== undefined);
  if (hue === undefined) hue = spacedHue(hashCode(person));
  for (let id of [person, ...ids]) nameHues.set(id, hue);
  for (let id of short) if (!nameHues.has(id)) nameHues.set(id, hue);
  return hue;
}

// the elements a scope's names are in, each saying which of its highlights it holds
const holders: Record<string, Element[]> = {};

// names put in colour: a highlight to a hue, those of the list in it, those still missing from it
// in one of their own, also underlined, so they read as something to click
function paint(scope: Scope, found: (Found & { person: string })[], persons: Persons) {
  // a copy of the names: the loop deletes from what it walks
  for (let styleId of Array.from(CSS.highlights.keys())) {
    if (styleId.startsWith(`${scope}-`)) CSS.highlights.delete(styleId);
  }
  for (let el of holders[scope] ?? []) el.removeAttribute('data-names');
  detectedNames[scope] = new Map();
  let { paper, prose } = themeColors();
  let styles = new Map<string, { css: string; ranges: Range[] }>();
  let held = new Map<Element, Set<string>>();
  for (let name of found) {
    let hue = hueOf(name.person, persons[name.person] ?? { ids: [name.person], short: [] });
    let styleId = `${scope}-${Math.round(hue / HUE_STEP) % HUES}${name.known ? '' : '-new'}`;
    let style = styles.get(styleId);
    if (!style) {
      let css = [
        `color: ${nameColor(hue, paper, prose)} !important;`,
        name.known ? '' : 'text-decoration: underline 1px dashed !important; text-underline-offset: 0.3em; text-decoration-skip-ink: none;',
      ].join(' ');
      styles.set(styleId, style = { css, ranges: [] });
    }
    style.ranges.push(name.range);
    let holder = name.range.startContainer.parentElement;
    if (holder) (held.get(holder) ?? held.set(holder, new Set()).get(holder)!).add(styleId);
    // only names still missing from the list are worth pointing at
    if (!name.known) {
      let node = name.range.startContainer;
      (detectedNames[scope].get(node) ?? detectedNames[scope].set(node, []).get(node)!).push(name);
    }
  }
  for (let [el, styleIds] of held) el.setAttribute('data-names', [...styleIds].join(' '));
  holders[scope] = [...held.keys()];
  for (let [styleId, { ranges }] of styles) CSS.highlights.set(styleId, new Highlight(...ranges));
  setHighlightStyles(scope, [...styles].map(([styleId, { css }]) => `[data-names~="${styleId}"]::highlight(${styleId}) { ${css} }`));
}

// a stretch of an element's text, from `start` to `end` in it, across the text nodes it is made
// of (a line with a link in it is a few); null when it runs out of them. What a person is, put
// beside their name (`.gender`, see ChapterText.tsrx), is none of the text
const ofText = { acceptNode: (node: Node) => node.parentElement?.closest('.gender') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT };
function rangeIn(el: Element, start: number, end: number) {
  let range = new Range();
  let at = 0;
  let started = false;
  let walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, ofText);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    let length = node.textContent!.length;
    if (!started && start < at + length) {
      range.setStart(node, start - at);
      started = true;
    }
    if (started && end <= at + length) {
      range.setEnd(node, end - at);
      return range;
    }
    at += length;
  }
  return null;
}

// the chapter's names, where the backend found them: the page scans nothing. They are painted as
// soon as the chapter is on the page, before the browser shows it without them
export async function paintChapter(chapter: Marked) {
  await tick();
  let elements = new Map([...document.querySelectorAll<HTMLElement>('article [data-offset]')].map(el => [Number(el.dataset.offset), el]));
  let found: (Found & { person: string })[] = [];
  for (let mark of chapter.marks) {
    let line = chapter.lines[mark.at];
    let el = line && elements.get(line.offset);
    let range = el && rangeIn(el, mark.start, mark.end);
    if (range) found.push({ range, name: line.text.slice(mark.start, mark.end), known: mark.known, person: mark.person });
  }
  paint('hl', found, chapter.persons);
}

// the names in short texts (the titles of the chapter list, the commands of the palette): those of
// the list, and those the chapter open gives when there is one, found as they are written. The
// patterns that find a name never seen before are the chapter's to run
export async function paintTitles(scope: Scope, selector: string, names: string, chapter?: Marked | null) {
  await nextTick();
  let { known, aliasOf } = listedPeople(names);
  let knownIds = new Set(known.map(name => name.toLowerCase()));
  let persons: Persons = { ...chapter?.persons };
  let personOf = new Map<string, string>();
  for (let [person, { ids }] of Object.entries(persons)) for (let id of ids) personOf.set(id, person);
  let words = [...new Set([...knownIds, ...personOf.keys()])];
  let found: (Found & { person: string })[] = [];
  if (words.length > 0) {
    let regex = anyOf(words);
    let nodes = [...document.querySelectorAll(selector)].flatMap(el => [...el.childNodes].filter(node => node.nodeType === Node.TEXT_NODE));
    for (let node of nodes) {
      for (let match of node.textContent!.matchAll(regex)) {
        let id = match[0].toLowerCase();
        let person = aliasOf.get(id) ?? personOf.get(id) ?? id;
        persons[person] ??= { ids: [person], short: [] };
        let range = new Range();
        range.setStart(node, match.index);
        range.setEnd(node, match.index + match[0].length);
        found.push({ range, name: match[0], known: knownIds.has(id), person });
      }
    }
  }
  paint(scope, found, persons);
}

// ---- adding a name from the page ----------------------------------------------------------
export type AddNameAt = { name: string; before: string; top: number; left: number };
// a name the list has already offers to say what its person is instead
export type AddNameOffer = AddNameAt & { relationship: boolean; aliases: string[]; person?: { name: string; gender?: Gender } };

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
    // a relationship is said of anybody, so it says nothing of who
    person: relationship ? undefined : listedPerson(names, at.name),
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
