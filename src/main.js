import { h, text, app } from 'hyperapp';
import { openDB } from 'idb';
import _ from 'lodash-es';
import chromaJs from 'chroma-js';
import parserSource from './parser.js?raw';
import bookSource from './book.js?raw';
import { loadParser } from './load-parser.js';

// the parser, and what a book is, as text: run here for the page, and handed to the worker
// that reads books (see readBook)
// @source:begin
const PARSER_SOURCE = parserSource;
const { normalizeFileContent, extractChapters, slug, latinize, Book, bookRecord, PARSER_VERSION } = loadParser(PARSER_SOURCE, bookSource, console);
// @source:end

class HashRouter extends EventTarget {
  parse(hash) {
    return Object.fromEntries(new URLSearchParams(hash));
  }
  get(key) {
    return new URLSearchParams(location.hash.slice(1)).get(key);
  }
  current() {
    return this.parse(location.hash.slice(1));
  }
  route(route) {
    let hash = new URLSearchParams(Object.entries(route).filter(([, v]) => v !== '' && v != null)).toString();
    if (hash) hash = `#${hash}`;
    return hash;
  }
  push(to) {
    let from = this.current();
    let allKeys = Object.keys({ ...from, ...to });
    // the url holds strings and the page numbers, and an absent value is null or undefined
    // biome-ignore lint/suspicious/noDoubleEquals: loose on purpose, '12' is 12 here
    let changed = allKeys.some(key => from[key] != to[key]);
    if (changed) {
      let url = new URL(location.href);
      url.hash = this.route(to);
      history.pushState(null, null, url);
    }
  }
  replace(to) {
    let from = this.current();
    let allKeys = Object.keys({ ...from, ...to });
    // the url holds strings and the page numbers, and an absent value is null or undefined
    // biome-ignore lint/suspicious/noDoubleEquals: loose on purpose, '12' is 12 here
    let changed = allKeys.some(key => from[key] != to[key]);
    if (changed) {
      let url = new URL(location.href);
      url.hash = this.route(to);
      history.replaceState(null, null, url);
    }
  }
}

// what keeps the books is chosen once, and everything kept is asked of it (see Backends)
let InitBackendDone = (state, { backend }) => [
  { ...state, backend },
  (dispatch) => {
    dispatch(LoadSettings);
    dispatch(LoadProgress);
    dispatch(LoadRecentBooks);
    dispatch(LoadRecentBook);
  }
];
let InitBackend = (state) => [
  state,
  async (dispatch) => dispatch(InitBackendDone, { backend: await chooseBackend() }),
];

let InitTheme = (state) => [
  state,
  (dispatch) => {
    let colors = { 'color:dark': 'night', 'color:light': 'white' };
    dispatch(ApplySettings, colors);
  }
];

let InitRouter = (state) => [
  state,
  (dispatch) => {
    addEventListener('hashchange', (event) => {
      let to = state.router.parse(new URL(event.newURL).hash.slice(1));
      if (!to.book) {
        dispatch(ShowRecentBooks);
      } else {
        dispatch(OpenBook, { bookId: to.book, offset: to.offset, chapterId: to.chapter });
      }
    });
  }
];

let InitKeyboardNavigator = (dispatch) => {
  let onKeyDown = (event) => {
    let formElements = ['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'];
    if(formElements.includes(event.target.tagName)) return;

    switch(event.key) {
      case 'ArrowRight': dispatch(OpenNextChapter, +1); break;
      case 'ArrowLeft': dispatch(OpenNextChapter, -1); break;
      case 'Backspace': dispatch(ShowRecentBooks); break;
      default: break;
    }
  };
  addEventListener('keydown', onKeyDown);
  return () => removeEventListener('keydown', onKeyDown);
};

let InitCommandPalette = async (dispatch) => {
  onKey('Cmd+K', ToggleCommandPalette)(dispatch);
  onKey('Escape', [ToggleCommandPalette, { open: false }])(dispatch);

  await nextTick();
  let dialog = document.querySelector('#command-palette');
  onKey('ArrowUp', SelectPrevCommand, { target: dialog })(dispatch);
  onKey('ArrowDown', SelectNextCommand, { target: dialog })(dispatch);
};

// a non-modal dialog is not dismissed for us
let InitFontPicker = (dispatch) => onKey('Escape', [ToggleFontPicker, { open: false }])(dispatch);

let ToggleCommandPalette = (state, options) => {
  let open = options?.open != null ? !!options.open : !state.commandPalette.open;
  return [
    {
      ...state,
      commandPalette: {
        ...state.commandPalette,
        open,
      }
    },
    async (dispatch) => {
      if(open) {
        await nextTick();
        document.querySelector('#command-palette input').select();
        dispatch(HighlightMatches);
        dispatch(HighlightNames, commandPaletteNames);
      }
    }
  ];
};

let SelectCommand = (state, index) => [
  {
    ...state,
    commandPalette: {
      ...state.commandPalette,
      selectedIndex: index,
    }
  },
  async () => {
    await nextTick();

    //scroll selected command into view
    let ul = document.querySelector('#command-palette ul');
    if (!ul) return;
    let li = ul.querySelector('li.selected');
    if (li.offsetTop < ul.scrollTop) {
      ul.scroll({ behavior: 'instant', top: li.offsetTop });
    } else if (ul.scrollTop + ul.clientHeight < li.offsetTop + li.clientHeight) {
      ul.scroll({ behavior: 'instant', top: li.offsetTop + li.clientHeight - ul.clientHeight });
    }
  }
];

let SelectNextCommand = (state) => [SelectCommand, state.commandPalette.selectedIndex + 1];
let SelectPrevCommand = (state) => [SelectCommand, state.commandPalette.selectedIndex - 1];

let SetCommandQuery = (state, q) => ({
  ...state,
  commandPalette: {
    ...state.commandPalette,
    q: q.trim().toLowerCase(),
  },
});

let HighlightMatches = (state) => [
  state,
  async () => {
    await nextTick();

    let ranges = [];
    let q = state.commandPalette.q;
    for (let el of document.querySelectorAll('#command-palette a')) {
      let text = el.firstChild;
      let match = latinize(text.textContent).toLowerCase();
      if(match.includes(q)) {
        let start = match.indexOf(q);
        let end = start + q.length;
        let range = new Range();
        range.setStart(text, start);
        range.setEnd(text, end);
        ranges.push(range);
      }
    }
    let hl = new Highlight(...ranges);
    CSS.highlights.set('match', hl);
  }
];

let MultipleActions = (state, actions) => [
  state,
  async (dispatch) => {
    for(let action of actions) {
      await nextTick();
      dispatch(...[].concat(action));
    }
  }
];

let nextTick = async () => {
  await new Promise(resolve => requestAnimationFrame(resolve));
  await new Promise(resolve => requestAnimationFrame(resolve));
};

let onKey = (key, action, options) => (dispatch) => {
  let el = options?.target || window;
  let onKeyDown = (event) => {
    let opts = key.toLowerCase().split('+').reduce((opts, k) => {
      switch(k) {
        case 'ctrl':
        case 'shift':
        case 'alt':
          opts[`${k}Key`] = true;
          break;
        case 'cmd':
        case 'win':
        case 'super':
          opts.metaKey = true;
          break;
        default:
          opts.key = k;
      }
      return opts;
    }, {});
    if(event.key.toLowerCase() === opts.key.toLowerCase() && ['metaKey', 'ctrlKey', 'shiftKey', 'altKey'].every(f => Boolean(event[f]) === Boolean(opts[f]))) {
      event.preventDefault();
      dispatch(action);
    }
  };
  el.addEventListener('keydown', onKeyDown);
  return () => el.removeEventListener('keydown', onKeyDown);
};

let LoadSettings = (state) => [
  state,
  async (dispatch) => dispatch(ApplySettings, await state.backend.settings()),
];
// a setting css can select on goes on the element. A list or a shape is for the
// app to read and only reads as junk in an attribute, so it stays out of one
let applyDataset = (key, value) => {
  if (value != null && typeof value === 'object') return;
  document.documentElement.dataset[key] = (value ?? '');
};
let ApplySettings = (state, settings) => [
  { ...state, settings: { ...state.settings, ...settings } },
  () => {
    for (let [key, value] of Object.entries(settings)) {
      applyDataset(key, value);
    }
  }
];
let SaveSettings = (state, settings) => [
  state,
  async (dispatch) => {
    dispatch(ApplySettings, settings);
    await state.backend.saveSettings(settings);
  }
];

// a font name reaches css as a quoted family, so a name is only ever read as
// a name - and Reader stays behind it for whatever the chosen face is missing
let cssFontFamily = (family) => `"${family.replace(/["\\]/g, '')}"`;
// the book and the chrome are set independently, and the panel switches between
// the two sets of the same three settings rather than growing a second row of them
let fontSettings = {
  reading: { family: 'font', size: 'fontSize', weight: 'fontWeight' },
  ui: { family: 'uiFont', size: 'uiFontSize', weight: 'uiFontWeight' },
};
// only chromium will say which fonts are installed, and only when the reader
// asks. Everywhere else a page can name a face but never learn what is there,
// so the list falls back to the ones worth reading a book in
let readingFonts = [
  'Source Serif 4', 'Iowan Old Style', 'Charter', 'Palatino', 'Baskerville',
  'Hoefler Text', 'Georgia', 'Literata', 'Cambria', 'Constantia',
  'Times New Roman', 'system-ui',
];

// chrome only remembers the fonts permission per origin, and a file:// page has
// none to remember it against: allowing it there is allowing it for that one call.
// So the list is kept once it is given, and asked for again only when asked to be
let LoadFonts = (state, { force } = {}) => [
  state,
  async (dispatch) => {
    if(!force && state.settings.fonts?.length > 0) return;
    if(!window.queryLocalFonts) return;
    try {
      let installed = await window.queryLocalFonts();
      // one entry per face, and a book is read in a family
      let fonts = [...new Set(installed.map(font => font.family))].sort((a, z) => a.localeCompare(z));
      if(fonts.length > 0) dispatch(SaveSettings, { fonts });
    } catch (error) {
      // refused, or asked for outside the click that opened the picker
      console.warn(error);
    }
  }
];

let SetFontQuery = (state, q) => ({ ...state, fontPicker: { ...state.fontPicker, q } });
let SetFontTarget = (state, target) => ({ ...state, fontPicker: { ...state.fontPicker, target } });
let ToggleFontPicker = (state, { open }) => [
  { ...state, fontPicker: { ...state.fontPicker, open, q: '' } },
  async (dispatch) => {
    if(!open) return;
    // queryLocalFonts only answers while the click that opened this still counts
    // as the reader asking, so the list is asked for before waiting on anything
    dispatch(LoadFonts);
    await nextTick();
    document.querySelector('#font-picker input').select();
  }
];
let ChooseFont = (state, font) => [
  state,
  (dispatch) => dispatch(SaveSettings, { [fontSettings[state.fontPicker.target].family]: font })
];

let LoadRecentBooksDone = (state, { files }) => ({ ...state, files });
let LoadRecentBooks = (state) => [
  state,
  async (dispatch) => {
    let files = await state.backend.files();
    files.sort((a, z) => a.name.localeCompare(z.name, 'vi-VN', { sensitivity: 'accent' }));
    dispatch(LoadRecentBooksDone, { files });
  }
];

let LoadProgressDone = (state, { progress }) => ({ ...state, progress });
let LoadProgress = (state) => [state, async (dispatch) => {
  dispatch(LoadProgressDone, { progress: await state.backend.progress() });
}];

let LoadRecentBook = (state) => [
  state,
  (dispatch) => {
    let bookId = state.router.get('book');
    let offset = state.router.get('offset');
    let chapterId = state.router.get('chapter');
    if (bookId) {
      dispatch(OpenBook, { bookId, offset, chapterId })
    }
  }
];

// an absent url param reads as null, and Number(null) is a perfectly good 0
let toOffset = (value) => {
  if(value == null || value === '') return;
  value = Number(value);
  if(Number.isFinite(value)) return value;
};
// the chapter a character offset falls in: the last one starting at or before it.
// an offset outlives a re-parse that retitles a chapter, which its slug never did
let chapterAt = (chapters, offset) => {
  offset = toOffset(offset);
  if(offset == null) return;
  let placed = chapters.filter(chapter => chapter.offset != null);
  return _.findLast(placed, chapter => chapter.offset <= offset) || placed[0];
};
// one paragraph per line, each with the offset it starts at in the book. The
// reader sees the names corrected, and that changes lengths, so the offsets are
// read off the text as stored
let lineSeparator = /\n|<\/?\w+>/gi;
let chapterLines = (chapter, fixNames) => {
  let fixed = fixNames(chapter.content).split(lineSeparator);
  let lines = [];
  let at = 0;
  for(let m of chapter.content.matchAll(lineSeparator)) {
    lines.push({ text: chapter.content.slice(at, m.index), offset: chapter.offset + at });
    at = m.index + m[0].length;
  }
  lines.push({ text: chapter.content.slice(at), offset: chapter.offset + at });
  // a correction that split or joined a line would shift every line after it
  if(fixed.length === lines.length) for(let [i, line] of lines.entries()) line.text = fixed[i];
  return lines;
};
// where the reader is: the topmost paragraph the page has not scrolled past. They
// come in document order, so a binary search costs a chapter of any length only a
// handful of measurements
let offsetAtTop = () => {
  let paragraphs = document.querySelectorAll('article [data-offset]');
  if(!paragraphs.length) return;
  let low = 0;
  let high = paragraphs.length - 1;
  while(low < high) {
    let middle = (low + high) >> 1;
    if(paragraphs[middle].getBoundingClientRect().bottom > 0) high = middle;
    else low = middle + 1;
  }
  return Number(paragraphs[low].dataset.offset);
};
// where in a book to reopen: its offset, or - for a bookmark or a progress record
// written before offsets - the chapter id it still names
let bookRoute = ({ bookId, offset, chapterId }) => (
  offset != null ? { book: bookId, offset } : { book: bookId, chapter: chapterId }
);
let OpenBookDone = (state, { book, chapter, offset }) => [
  { ...state, book, chapter },
  () => {
    let route = bookRoute({ bookId: book.id, offset: offset ?? chapter.offset, chapterId: chapter.id });
    if (state.book?.id == book.id) state.router.replace(route);
    else state.router.push(route);

    document.title = book.name;

    requestAnimationFrame(() => {
      // a link into the middle of a chapter opens where it points
      let paragraphs = [...document.querySelectorAll('article [data-offset]')];
      let at = _.findLast(paragraphs, el => Number(el.dataset.offset) <= offset);
      if (at && at != paragraphs[0]) at.scrollIntoView({ block: 'start' });
      else scroll(0, 0);

      //scroll bookmark into view
      let bookmark = document.querySelector('nav .active');
      let nav = document.querySelector('nav');
      let bookmarkRect = bookmark.getBoundingClientRect();
      let isOutOfView = bookmarkRect.top < 0 || nav.clientHeight < bookmarkRect.bottom;
      if (isOutOfView) bookmark.scrollIntoView({ block: 'center' });
    });
  }
];
// `offset` says where to open, `chapterId` is only what an older bookmark or
// progress record has instead. Both may be missing, and then the book starts over
let OpenBook = (state, { bookId, offset, chapterId }) => [
  state,
  async (dispatch) => {
    if (!bookId) {
      console.info('Failed to load file:', { bookId, offset, chapterId });
      return;
    }
    // nothing to go on means the book starts over
    let listedIn = (book) => chapterAt(book.chapters, offset)
      || book.chapters.find(c => c.id == chapterId)
      || book.chapters[0];

    // the backend reads the book again when an older parser read it
    let book = await state.backend.book(bookId);
    if (!book) {
      console.info('Book not found:', { bookId });
      return;
    }
    let listed = listedIn(book);
    let chapter = await state.backend.chapter(bookId, listed);
    // a record that lists a chapter whose text is gone is read again, once
    if (!chapter) {
      console.info('Chapter not found:', { bookId, offset, chapterId, id: listed.id });
      book = await state.backend.rereadBook(bookId);
      listed = book && listedIn(book);
      chapter = book && await state.backend.chapter(bookId, listed);
      if (!chapter) return;
    }
    // an offset inside the chapter is a place on its page, not just the chapter
    let position = Math.max(toOffset(offset) ?? 0, listed.offset ?? 0);

    dispatch(LoadNames, { bookId: book.id });
    dispatch(OpenBookDone, { book, chapter, offset: position });
    dispatch(ToggleCommandPalette, { open: false });
    clearTimeout(window.saveProgressTimer);
    window.saveProgressTimer = setTimeout(() => {
      dispatch(SaveProgress, { book, chapter, offset: position });
    }, 10000);
  }
];

let ToggleNamesEditor = (state, { open }) => ({ ...state, namesEditor: { ...state.namesEditor, open } });
let SetNames = (state, names) => ({ ...state, namesEditor: { ...state.namesEditor, names } });
let SaveNames = (state, { bookId, names }) => [state, async () => {
  names = names.trim() + '\n';
  await state.backend.saveNames(bookId, names);
}];
let LoadNames = (state, { bookId }) => [state, async (dispatch) => {
  let names = await state.backend.names(bookId);
  dispatch(SetNames, names);
  dispatch(HighlightNames);
}];
let sameAddName = (a, z) => a?.name == z?.name && a?.top == z?.top && a?.left == z?.left;
let ShowAddName = (state, addName) => {
  // mousemove and selectionchange fire a lot, don't re-render for nothing
  if(sameAddName(state.namesEditor.addName, addName)) return state;
  // who this name could be, worked out here because only the state knows the list
  if(addName) {
    let relationship = isRelationship(addName.name);
    addName = {
      ...addName,
      relationship,
      // a relationship shares no word with a name, so who it belongs to can only
      // come from the text: whoever was last named before it was said
      aliases: relationship
        ? kinCandidates(state.namesEditor.names, addName.before)
        : aliasCandidates(state.namesEditor.names, addName.name),
    };
  }
  return { ...state, namesEditor: { ...state.namesEditor, addName } };
};
// `alias` is the person this name belongs to: it joins their line instead of
// starting one of its own, which is what puts them in the same color group.
// `(a relationship)` is written in lower case whatever the text called it: the
// parens are what the reader edits, the case in there would only be noise
let AddName = (state, { name, alias, relationship }) => {
  if(!state.book) return ShowAddName(state, null);
  let names = (state.namesEditor.names || '').trim();
  if(nameIdsOf(names).includes(name.toLowerCase())) return ShowAddName(state, null);
  let entry = relationship ? `(${name.toLowerCase()})` : name;
  if(alias) {
    let lines = names.split('\n');
    let line = listedNames(names).findIndex(({ names: lineNames }) => lineNames[0] == alias);
    // the list was edited out from under the button, don't guess where to put it
    if(line < 0) return ShowAddName(state, null);
    lines[line] = lines[line].trimEnd() + ', ' + entry;
    names = lines.join('\n') + '\n';
  } else {
    names = (names ? names + '\n' : '') + entry + '\n';
  }
  return [
    { ...state, namesEditor: { ...state.namesEditor, names, addName: null } },
    (dispatch) => {
      getSelection().removeAllRanges();
      dispatch(SaveNames, { bookId: state.book.id, names });
      dispatch(HighlightNames);
      dispatch(HighlightNames, commandPaletteNames);
    }
  ];
};
// a translation often leaves the plain Vietnamese word where the name wants the
// Sino-Vietnamese one: `Công Tôn ngày` for `Công Tôn Thiên`. First word of each
// group is the one a name is written with, the rest are what to also look for
let nameWordGroups = [
  ['vũ', 'mưa'],
  ['khinh', 'nhẹ'],
  ['vân', 'mây'],
  ['nhan', 'mặt'],
  ['thiên', 'ngày'],
];
let nameWords = Object.fromEntries(nameWordGroups.flatMap(([nameWord, ...others]) => (
  others.map(other => [other, nameWord])
)));
let mapNameWords = (name) => name.split(' ')
  .map(word => toCase(nameWords[word.toLowerCase()] || word, getCase(word)))
  .join(' ');
// match a listed name however its words were translated. only for names of two
// words or more: on its own `ngày` is the everyday word far more often than a name
let nameWordPattern = (name) => {
  // a name is text to look for, never a pattern: the half-typed `Giản Ninh (lão`
  // of a relationship being written would otherwise leave a group unterminated
  name = _.escapeRegExp(name);
  if(!name.trim().includes(' ')) return name;
  return name.replace(/\p{L}+/gu, word => {
    let group = nameWordGroups.find(group => group.includes(word.toLowerCase()));
    return group ? `(?:${group.join('|')})` : word;
  });
};
// `(đại ca)` is what somebody is called, not what they are named: it takes the
// person's color wherever it shows up, but the text keeps the case it is written
// in - `đại ca` is a word of the sentence, and titling it would read as a name.
// It can stand on its own or trail the name it belongs to, `Giản Ninh (lão bà)`
let splitRelationship = (entry) => {
  let [, name, relationship] = entry.trim().match(/^(.*?)\s*\((.*)\)$/) || [];
  if(relationship == undefined) return { name: entry.trim() };
  return { name, relationship: relationship.trim() };
};
// how a reader is likely to have somebody addressed. The doubled and compound
// ones stand on their own in the text, so they are worth detecting; a bare
// `nương` is the everyday word far more often, and is only ever added by hand
let standaloneRelationships = [
  'cô cô', 'thúc thúc', 'bá bá', 'thẩm thẩm', 'nhạc phụ', 'nhạc mẫu', 'bá phụ',
  'bá mẫu', 'tiểu di', 'ca ca', 'tỷ tỷ', 'muội muội', 'lão bà', 'lão công',
  'phụ thân', 'mẫu thân',
];
let relationshipWords = new Set([...standaloneRelationships, 'nương']);
let isRelationship = (name) => relationshipWords.has(name.trim().toLowerCase());
// whichever side of a `from -> to` entry the text ends up reading
let entryTarget = (entry) => entry.split(/->|→/).at(-1).trim();
// a relationship renamed in the text is still a word of the sentence, so the
// new wording is written the way the old one was: `Lão bà` opening a sentence
// comes back as `Bà xã`, mid-sentence as `bà xã`, and a shout stays a shout
let followCase = (src, dst) => {
  let _case = getCase(src.trim().split(/\s+/)[0]);
  if(_case === 'upper') return dst.toUpperCase();
  if(_case === 'title') return dst[0].toUpperCase() + dst.slice(1).toLowerCase();
  return dst.toLowerCase();
};
// the name a `from -> to` entry ends up written as in the text, which is what
// the highlighter has to look for: anything else and the edit reads as detected
let editedName = (entry) => {
  let [from, to] = entry.split(/->|→/).map(n => n?.trim());
  if(to == undefined) {
    from = entry;
    to = titleCase(entry);
  } else {
    to = useCase(from, to);
  }
  if(typeof to === 'function') to = to(from);
  return to && mapNameWords(to);
};
memoize(function correctNames(content, names) {
  if(!names) return content;
  // every name on the same line is the same person, so each one still gets
  // corrected on its own; `aliasOf` in HighlightNames is what ties them together
  // the names of an entry are corrected, and a `(relationship)` only where it
  // is renamed outright. A relationship is a word of the sentence, not somebody's
  // name: listing it plain only says who it is said of - the text keeps it exactly
  // as written and the highlighter colors it where it stands. `lão bà -> bà xã`
  // asks for the wording itself to change, and that is worth doing, in the case
  // the text wrote it in rather than the one the list is typed in
  let entries = names.split(/[\n,]/).flatMap(entry => {
    let { name, relationship } = splitRelationship(entry);
    return [
      name && { text: name },
      relationship && /->|→/.test(relationship) && { text: relationship, relationship: true },
    ].filter(Boolean);
  });
  // add short name automatically
  for(let { text, relationship } of entries) {
    if(relationship || text.match(/->|→/)) continue;
    let words = text.split(/\s/);
    if(words.length === 3 || words.length === 4) entries.push({ text: words.at(-2) + ' ' + words.at(-1) });
  }
  for(let { text, relationship } of entries) {
    text = text.trim();
    if (!text) continue;
    let [from, to] = text.split(/->|→/).map(n => n?.trim());
    if(to == undefined) {
      from = text;
      to = titleCase(text);
    } else if(relationship) {
      let wording = to;
      to = (name) => followCase(name, wording);
    } else {
      to = useCase(from, to);
    }
    if(from) {
      let fromRegex = new RegExp(`(?<=^|[^\\p{L}])${nameWordPattern(from)}(?=[^\\p{L}]|$)`, 'gui');
      content = content.replaceAll(fromRegex, name => (
        mapNameWords(typeof to === 'function' ? to(name) : to)
      ));
    }
  }
  return content;
});
// hue per name id, kept for the whole session: the same character can show up
// as `Lý Tiêu Dao` in one chapter and only as `Tiêu Dao` in the next, so
// hashing whichever id survives the merge below would recolor them mid-book
let nameHues = new Map();
// degrees around the wheel are not what the eye measures - 30 of them through the
// blues barely change the colour, where 30 through the reds are a different one - so
// a name is kept a distance from the others in what is actually seen. It starts on
// the hue its name hashes to, which is what makes the colour its own and the same
// one every time, and walks on only far enough to stop looking like somebody else
let nameDeltaE = 20;
// the hue is judged at one fixed lightness, not on the paper in front of us: a
// character keeps the hue they were given when the theme changes, so choosing it
// against the paper of the moment would only space the cast for the theme it
// happened to be assigned under, and crowd them on every other one
let spacingColor = (hue) => {
  for(let c = 110; c >= 25; c -= 5) {
    let color = chromaJs.hcl(hue, c, 60);
    if(!color.clipped()) return color;
  }
  return chromaJs.hcl(hue, 25, 60);
};
let spacedHue = (seed) => {
  let hue = ((seed % 360) + 360) % 360;
  let taken = [...new Set(nameHues.values())].map(spacingColor);
  if(!taken.length) return hue;
  let best = { hue, distance: -1 };
  for(let step = 0; step < 360; step += 5) {
    let candidate = (hue + step) % 360;
    let color = spacingColor(candidate);
    let distance = Math.min(...taken.map(c => chromaJs.deltaE(color, c)));
    if(distance >= nameDeltaE) return candidate;
    if(distance > best.distance) best = { hue: candidate, distance };
  }
  // the cast is bigger than the wheel has room for; take the least alike there is
  return best.hue;
};
// the colour is read off the page it will sit on, so both the paper and the prose
// are asked for rather than assumed. The prose is taken as it is painted and not as
// it is written: the gray theme sets its text in white at 78%, and a name has to
// differ from what is on the paper, not from what was asked for
let paperColor = () => {
  let paper = getComputedStyle(document.body).getPropertyValue('--paper-background-color').trim();
  try { return chromaJs(paper || '#fff'); } catch { return chromaJs('#fff'); }
};
let proseColor = (paper) => {
  try {
    let prose = chromaJs(getComputedStyle(document.body).color);
    return prose.alpha() < 1 ? chromaJs.mix(paper, prose, prose.alpha(), 'rgb') : prose;
  } catch {
    return paper.luminance() < 0.4 ? chromaJs('#fff') : chromaJs('#000');
  }
};
// the most colour a hue will carry at a lightness, which is wherever sRGB runs out.
// Asking past that clips, and clipped colours come out both muddy and alike
let mostChroma = (hue, l) => {
  for(let c = 132; c > 0; c -= 2) {
    let color = chromaJs.hcl(hue, c, l);
    if(!color.clipped()) return { color, chroma: c };
  }
  return { color: chromaJs.hcl(hue, 0, l), chroma: 0 };
};
// being readable on the paper was only half of it. A name also has to be told from
// the sentence it is standing in, and on a page of near-black prose every colour is
// the lighter mark and so the weaker one - what is left to say `name` with is how
// much colour it carries. So the lightness is not settled first: every lightness the
// paper will take is tried and the most colourful one wins, which is what stopping at
// the lightest readable one was quietly giving up. A floor against the prose itself
// keeps a hue from landing on the very colour the words are written in
let nameContrast = 4.5;
let proseDeltaE = 15;
let nameColor = (hue, paper, prose) => {
  let best, readable;
  for(let l = 20; l <= 96; l += 2) {
    let found = mostChroma(hue, l);
    if(chromaJs.contrast(found.color, paper) < nameContrast) continue;
    if(!readable || found.chroma > readable.chroma) readable = found;
    if(chromaJs.deltaE(found.color, prose) < proseDeltaE) continue;
    if(!best || found.chroma > best.chroma) best = found;
  }
  // a hue with nowhere to stand on this paper: being read beats being colourful
  return (best || readable || { color: prose }).color;
};
let shortNameId = (nameId) => {
  let words = nameId.trim().split(/\s+/);
  if(words.length === 3 || words.length === 4) return words.slice(-2).join(' ');
};
// every name the editor already knows about, one id per entry
let nameIdsOf = (names) => (names || '').split(/[\n,]/)
  .flatMap(entry => Object.values(splitRelationship(entry)))
  .map(entry => entryTarget(entry).toLowerCase())
  .filter(Boolean);
// one entry per line of the editor, in the same order, so a line can be found
// again by what it holds. Every name on a line is the same person and the first
// one names them; the auto short name rides along with the name it comes from.
// A `(relationship)` on the line is theirs too, kept apart from their names
// because it is not one: nothing is derived from it and nothing binds to it
let listedNames = (names) => (names || '').split('\n').map(line => {
  let lineNames = [];
  let relationships = [];
  for(let entry of line.split(',')) {
    let { name, relationship } = splitRelationship(entry);
    if(relationship) relationships.push(entryTarget(relationship));
    entry = name;
    if(!entry) continue;
    let hasArrow = /->|→/.test(entry);
    let to = editedName(entry);
    // a lowercase entry is a wording fix, not a name to highlight
    if(!to || getCase(to) === 'lower') continue;
    lineNames.push(to);
    // add short name automatically
    let shortName = hasArrow ? undefined : shortNameId(to);
    if(shortName) lineNames.push(shortName);
  }
  return { names: lineNames, relationships };
});
let nameWordsOf = (name) => name.toLowerCase().split(/\s+/).filter(Boolean);
// `tiểu`, `lão` and `a` name nobody, they are how somebody is addressed - the
// same words namePatterns detects a name behind. What is left of `Tiểu Lôi Tử`
// or `Lôi Nhi` once they are gone is the `Lôi` the name is really made of
let honorificPrefixes = ['a', 'tiểu', 'lão'];
let plainNameWords = (words) => {
  let prefixed = words.length > 1 && honorificPrefixes.includes(words[0]);
  if(prefixed) words = words.slice(1);
  // `nhi` is a fond form of any name, `tử` only ever tags along with a prefix:
  // on its own `Khổng Tử` is a whole name, not a `Khổng` being addressed
  let suffixes = prefixed ? ['nhi', 'tử'] : ['nhi'];
  if(words.length > 1 && suffixes.includes(words.at(-1))) words = words.slice(0, -1);
  return words;
};
// `Lôi Lôi` and `Tiểu Lôi` are nobody new, they are what somebody calls
// `Lục Nguyệt Lôi`: every word they are written with is a word of the full name.
// The suffix merge in HighlightNames only catches the names that *end* the same
// way, so these are offered as a row on the add button - guessed at, never assumed
let aliasCandidates = (names, name) => {
  let words = plainNameWords(nameWordsOf(name));
  let nameId = name.toLowerCase();
  let candidates = [];
  for(let { names: lineNames } of listedNames(names)) {
    if(!lineNames.length) continue;
    // already this person's name, there is nothing left to bind
    if(lineNames.some(listed => listed.toLowerCase() == nameId)) return [];
    let derivedFrom = lineNames
      .map(nameWordsOf)
      .filter(listedWords => words.every(word => listedWords.includes(word)));
    if(!derivedFrom.length) continue;
    candidates.push({
      // the first name on the line is the one that names the person
      canonical: lineNames[0],
      // a nickname is made from the end of a name far more often than its start
      onLastWord: derivedFrom.some(listedWords => words.includes(listedWords.at(-1))),
      length: Math.min(...derivedFrom.map(listedWords => listedWords.length)),
    });
  }
  return _.sortBy(candidates, [candidate => !candidate.onLastWord, 'length'])
    .slice(0, 3)
    .map(candidate => candidate.canonical);
};
// `ca ca` belongs to whoever the paragraph was talking about, and the nearest
// name before it is the best guess there is: `Lôi Nhi nhìn ca ca` is his, not
// that of the person named three sentences ago. Offered as rows, never assumed
let kinCandidates = (names, before) => {
  if(!before) return [];
  let candidates = [];
  for(let { names: lineNames } of listedNames(names)) {
    if(!lineNames.length) continue;
    let at = Math.max(...lineNames.map(name => (
      before.toLowerCase().lastIndexOf(name.toLowerCase())
    )));
    if(at >= 0) candidates.push({ canonical: lineNames[0], at });
  }
  return _.sortBy(candidates, candidate => -candidate.at)
    .slice(0, 3)
    .map(candidate => candidate.canonical);
};
// scope prefix -> (text node -> the names found in it), for hit testing the pointer
let detectedNames = {};
let isWordChar = (char) => char != undefined && /[\p{L}\p{N}]/u.test(char);
// a partially selected word counts as the whole word
let wholeWords = (range) => {
  range = range.cloneRange();
  let { startContainer, endContainer } = range;
  if(startContainer.nodeType == Node.TEXT_NODE) {
    let text = startContainer.textContent;
    // only when the selection really starts inside a word, not next to one
    while(isWordChar(text[range.startOffset]) && isWordChar(text[range.startOffset - 1])) {
      range.setStart(startContainer, range.startOffset - 1);
    }
  }
  if(endContainer.nodeType == Node.TEXT_NODE) {
    let text = endContainer.textContent;
    while(isWordChar(text[range.endOffset - 1]) && isWordChar(text[range.endOffset])) {
      range.setEnd(endContainer, range.endOffset + 1);
    }
  }
  return range;
};
let asName = (range) => {
  let name = range.toString()
    .replace(/\s+/g, ' ')
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  if(name.length > 80 || !/\p{L}/u.test(name)) return;
  return name;
};
// where to float the button: centered on top of what it would add, but always
// far enough inside the viewport to stay clickable. a name wrapped over two
// lines has one rect per line, and their union spans the whole column, so
// anchor to the line the pointer is on instead of to the union
let addNameAt = (range, name, x, y) => {
  let rects = [...range.getClientRects()].filter(rect => rect.width || rect.height);
  if(!rects.length) return;
  // vertical distance first: the pointer sits between two lines far more often
  // than it sits past the end of the one it is on
  let rect = y == undefined ? rects[0] : _.minBy(rects, rect => (
    Math.max(rect.top - y, y - rect.bottom, 0) * 1e4 +
    Math.max(rect.left - x, x - rect.right, 0)
  ));
  return {
    name,
    // the paragraph up to here, as far as the text node it starts in reaches
    before: range.startContainer.nodeType == Node.TEXT_NODE
      ? range.startContainer.textContent.slice(0, range.startOffset)
      : '',
    top: Math.round(Math.max(rect.top, 30)),
    left: Math.round(_.clamp(rect.left + rect.width / 2, 60, innerWidth - 60)),
  };
};
let setHighlightStyle = (styleId, css) => {
  let styleEl = document.head.querySelector(`style[name="${styleId}"]`);
  if(!styleEl) {
    styleEl = document.createElement('style');
    styleEl.setAttribute('name', styleId);
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `::highlight(${styleId}) { ${css} }`;
};
let caretAt = (x, y) => {
  let position = document.caretPositionFromPoint?.(x, y);
  if(position) return { node: position.offsetNode, offset: position.offset };
  let range = document.caretRangeFromPoint?.(x, y);
  if(range) return { node: range.startContainer, offset: range.startOffset };
};
let detectedNameAt = (x, y) => {
  let caret = caretAt(x, y);
  if(!caret) return;
  for(let byNode of Object.values(detectedNames)) {
    let found = (byNode.get(caret.node) || []).find(({ range }) => (
      caret.offset >= range.startOffset && caret.offset <= range.endOffset &&
      [...range.getClientRects()].some(rect => (
        x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
      ))
    ));
    if(found) return found;
  }
};
// the article and the command palette are highlighted independently, each pass
// owning its own style ids, so one can be refreshed without redoing the other
let articleNames = { selector: 'article p, nav a', prefix: 'hl' };
let commandPaletteNames = { selector: '#command-palette a', prefix: 'cp' };
let HighlightNames = (state, { selector, prefix } = articleNames) => [state, async () => {
  await nextTick();

  for(let styleId of [...CSS.highlights.keys()]) {
    if(styleId.startsWith(prefix + '-')) CSS.highlights.delete(styleId);
  }
  detectedNames[prefix] = new Map();
  let paper = paperColor();
  let prose = proseColor(paper);

  // names from editor
  let knowNames = [];
  let aliasOf = new Map();
  for(let { names: lineNames, relationships } of listedNames(state.namesEditor.names)) {
    knowNames.push(...lineNames, ...relationships);
    // the first name on the line names the person, the rest point back to it -
    // a relationship never names them, it only ever points back
    let [canonicalId, ...aliasIds] = [...lineNames, ...relationships]
      .map(name => name.toLowerCase());
    for(let aliasId of aliasIds) {
      if(aliasId != canonicalId && !aliasOf.has(aliasId)) aliasOf.set(aliasId, canonicalId);
    }
  }

  let knowNameIds = new Set(knowNames.map(name => name.toLowerCase()));

  // collect names, by descending confidence: what the editor says, then the
  // general patterns, then the ones that hang on a lowercase prefix like `a Tô`.
  // the tiers are scanned apart on purpose - in one regex `a Tô` would consume
  // the start of `Tô Diễm` and the real name would never even be collected
  let namePlaceholders = {
    'wb': /$|(?<=[^\p{L}])|(?=[^\p{L}])/,
    'Upper': /\p{Lu}/,
    'Lower': /\p{Ll}/,
    'Word': /{wb}{Upper}{Lower}*{wb}/,
    'NameBegin': /(?<!^|[.:"'!?()[\]] ?|{Word} )/,
  };
  let namePatterns = [
    [
      /{NameBegin}{Word}(\s{Word}){1,3}/,
      /{NameBegin}({Word} )?{Word} (ba( ba)?|mụ mụ|mẹ|thúc|di|ca( ca)?|tỷ( tỷ)?|tổng|lang|nô|bá( bá)?|bá phụ|bá mẫu|đại tỷ|đại ca|lão bà){wb}/,
      new RegExp(standaloneRelationships.join('|')),
    ],
    [
      /{wb}a {Word}(?!{Word})/,
      /(tiểu|lão) {Word}(?!{wb}{Word})( tử)?/,
    ],
  ];
  // the editor's own names need no collecting, they are already the whole tier
  let names = [knowNames, ...namePatterns.map(() => [])];
  let seen = new Set(knowNameIds);
  let collect = (tier, name) => {
    let nameId = name.toLowerCase();
    // whatever a better tier already claims stays there
    if(seen.has(nameId)) return;
    seen.add(nameId);
    names[tier].push(name);
  };
  let collectRegexes = namePatterns.map(patterns => buildRegex(patterns, namePlaceholders, 'gu'));
  document.querySelectorAll(selector).forEach(el => {
    el.childNodes.forEach(el => {
      if (el.nodeType != Node.TEXT_NODE) return;

      collectRegexes.forEach((nameRegex, index) => {
        for(let match of el.textContent.matchAll(nameRegex)) {
          collect(index + 1, match[0]);
          let words = match[0].split(/\s/);
          if(words.length === 3 || words.length === 4) collect(index + 1, words.at(-2) + ' ' + words.at(-1));
        }
      });
    });
  });
  names = names.map(tier => tier.sort((a, z) => z.length - a.length));
  // an empty alternation below would match the empty string everywhere
  if(!names.some(tier => tier.length)) return;

  // create ranges;
  let nameRegexes = names.map(tier => tier.length && buildRegex([
    '{wb}(' + tier.map(name => _.escapeRegExp(name)).join('|') + '){wb}',
  ], {
    'wb': /^|$|(?<=[^\p{L}])|(?=[^\p{L}])/,
  }, 'gui'));
  let ranges = {};
  document.querySelectorAll(selector).forEach(el => {
    el.childNodes.forEach(el => {
      if (el.nodeType != Node.TEXT_NODE) return;

      let matches = [];
      nameRegexes.forEach((nameRegex, tier) => {
        if(!nameRegex) return;
        for(let match of el.textContent.matchAll(nameRegex)) {
          matches.push({ tier, name: match[0], start: match.index, end: match.index + match[0].length });
        }
      });
      // a name from the editor wins over a pattern, and a longer name over a
      // shorter one; anything overlapping what is already taken is dropped, so a
      // prefix loses to the real name inside it no matter which starts first
      matches.sort((a, z) => (a.tier - z.tier) || (z.name.length - a.name.length) || (a.start - z.start));

      let taken = [];
      for(let { name, start, end } of matches) {
        if(taken.some(other => start < other.end && other.start < end)) continue;
        taken.push({ start, end });

        let range = new Range();
        range.setStart(el, start);
        range.setEnd(el, end);
        let nameId = name.toLowerCase();
        let found = { range, name, known: knowNameIds.has(nameId) };
        if(!ranges[nameId]) ranges[nameId] = [];
        ranges[nameId].push(found);
        // only names still missing from the list are worth pointing at
        if(!found.known) {
          if(!detectedNames[prefix].has(el)) detectedNames[prefix].set(el, []);
          detectedNames[prefix].get(el).push(found);
        }
      }
    });
  });

  // merge sub ranges
  let nameIds = Object.keys(ranges).sort((a, z) => z.length - a.length);
  let aliases = {};
  for(let nameId in ranges) {
    // an explicit alias already says who this is, don't guess from the suffix
    if(aliasOf.has(nameId)) continue;
    let fullNameId = nameIds.find(id => id.endsWith(' ' + nameId));
    if(fullNameId && ranges[fullNameId]) {
      ranges[fullNameId].push(...ranges[nameId]);
      if(!aliases[fullNameId]) aliases[fullNameId] = [fullNameId];
      aliases[fullNameId].push(nameId);
      delete ranges[nameId];
    }
  }

  // one group per person: names the editor lists on the same line share a key,
  // which is also the key their hue is remembered under
  let groups = {};
  for(let nameId in ranges) {
    let groupId = aliasOf.get(nameId) || nameId;
    if(!groups[groupId]) groups[groupId] = { ids: [], ranges: [] };
    groups[groupId].ids.push(...(aliases[nameId] || [nameId]));
    groups[groupId].ranges.push(...ranges[nameId]);
  }

  for(let groupId in groups) {
    // reuse the hue of any id this character is already known by, including the
    // short name derived from a full one, so it stays the same across chapters
    let { ids, ranges: groupRanges } = groups[groupId];
    // a short name the editor gave to somebody else is not this person's
    let shortIds = ids.map(shortNameId)
      .filter(id => id && !ids.includes(id) && (aliasOf.get(id) || groupId) == groupId);
    let hue = [groupId, ...ids, ...shortIds].map(id => nameHues.get(id)).find(hue => hue != undefined);
    if(hue == undefined) hue = spacedHue(hashCode(groupId));
    for(let id of [groupId, ...ids]) nameHues.set(id, hue);
    for(let id of shortIds) if(!nameHues.has(id)) nameHues.set(id, hue);

    let color = nameColor(hue, paper, prose);
    // keyed by name, not by hue: distinct names do collide on a hue, and
    // CSS.highlights.set would then drop one of their highlights entirely
    let styleId = prefix + '-' + (hashCode(groupId) >>> 0).toString(36);
    // a name already in the list only gets its color, one still missing from it
    // also gets a dashed underline, so it reads as something to click
    for(let [suffix, known] of [['', true], ['-new', false]]) {
      let found = groupRanges.filter(found => found.known == known);
      if(!found.length) continue;
      let highlight = new Highlight();
      for(let { range } of found) {
        highlight.add(range);
      }
      CSS.highlights.set(styleId + suffix, highlight);
      setHighlightStyle(styleId + suffix, [
        `color: ${color} !important;`,
        known ? '' : 'text-decoration: underline 1px dashed !important; text-underline-offset: 0.3em; text-decoration-skip-ink: none;',
      ].join(' '));
    }
  }
}];

let InitAddNameButton = (dispatch) => {
  let hideTimer;
  // the last pointer position, so a selection that wraps over two lines can be
  // anchored to the line being dragged over, not to the first one
  let pointer = {};
  let show = (addName) => {
    clearTimeout(hideTimer);
    if(addName) dispatch(ShowAddName, addName);
    // a small grace period, the pointer has to travel to the button
    else hideTimer = setTimeout(() => dispatch(ShowAddName, null), 300);
  };
  let selectedName = () => {
    let selection = getSelection();
    if(!selection.rangeCount || selection.isCollapsed) return;
    let range = wholeWords(selection.getRangeAt(0));
    let el = range.commonAncestorContainer;
    if(el.nodeType == Node.TEXT_NODE) el = el.parentElement;
    if(!el?.closest('article, nav, #command-palette')) return;
    let name = asName(range);
    if(name) return addNameAt(range, name, pointer.x, pointer.y);
  };
  let busy = () => document.querySelector('#names-editor[open], #font-picker[open]');
  let hoveredName = (x, y) => {
    // a selection is the more explicit ask, let it win
    if(!getSelection().isCollapsed) return;
    let found = detectedNameAt(x, y);
    if(found) return addNameAt(found.range, found.name, x, y);
  };
  let onMouseMove = (event) => {
    // moving onto the button itself must not take it away
    if(event.target.closest?.('#add-name')) return clearTimeout(hideTimer);
    pointer = { x: event.clientX, y: event.clientY };
    show(!busy() && (selectedName() || hoveredName(event.clientX, event.clientY)));
  };
  let onSelectionChange = () => show(!busy() && selectedName());
  addEventListener('mousemove', onMouseMove);
  // the button is fixed, so a scroll slides the name out from under it
  addEventListener('scroll', onSelectionChange, { capture: true, passive: true });
  document.addEventListener('selectionchange', onSelectionChange);
  return () => {
    clearTimeout(hideTimer);
    removeEventListener('mousemove', onMouseMove);
    removeEventListener('scroll', onSelectionChange, { capture: true });
    document.removeEventListener('selectionchange', onSelectionChange);
  };
};

let OpenNextChapter = (state, indexDelta = 1) => [
  state,
  (dispatch) => {
    let chapterIndex = state.book.chapters.findIndex(c => c.id == state.chapter.id);
    let nextChapter = state.book.chapters[chapterIndex + indexDelta];
    if (nextChapter) {
      dispatch(OpenBook, { bookId: state.book.id, offset: nextChapter.offset });
    }
  }
];

// the url follows the reader down the page. It returns the same state on purpose:
// a scroll must not re-render the chapter it is scrolling
let TrackReadingOffset = (state, offset) => {
  if (!state.book || !state.chapter) return state;
  // the page can still be showing the chapter we just left
  let start = state.chapter.offset;
  if (!(offset >= start && offset <= start + state.chapter.content.length)) return state;
  if (toOffset(state.router.get('offset')) == offset) return state;
  return [
    state,
    (dispatch) => {
      state.router.replace(bookRoute({ bookId: state.book.id, offset }));
      clearTimeout(window.saveProgressTimer);
      window.saveProgressTimer = setTimeout(() => {
        dispatch(SaveProgress, { book: state.book, chapter: state.chapter, offset });
      }, 3000);
    }
  ];
};
let InitReadingOffset = (dispatch) => {
  let timer;
  let onScroll = () => {
    clearTimeout(timer);
    // history.replaceState is rate limited, a scroll fires far more often than that
    timer = setTimeout(() => {
      let offset = offsetAtTop();
      if (offset != null) dispatch(TrackReadingOffset, offset);
    }, 200);
  };
  // no capture: scrolling the chapter list is not reading
  addEventListener('scroll', onScroll, { passive: true });
  return () => {
    clearTimeout(timer);
    removeEventListener('scroll', onScroll);
  };
};

let SaveProgressDone = (state, { book, progress }) => ({ ...state, progress: { ...state.progress, [book.id]: progress } });
let SaveProgress = (state, { book, chapter, offset }) => {
  return [
    state,
    async (dispatch) => {
      let progress = { ...state.progress[book.id] };
      progress.offset = offset ?? chapter.offset;
      progress.chapterId = chapter.id;
      progress.chapterIndex = book.chapters.findIndex(c => c.id == chapter.id) + (book.chapters[0].id ? 1 : 0);
      progress.chapterCount = (book.chapters[0].id ? book.chapters.length : book.chapters.length - 1);
      progress.updatedAt = new Date().toISOString();
      await state.backend.saveProgress(book.id, progress);
      dispatch(SaveProgressDone, { book, progress });
    }
  ];
};

let InitDropzone = (state) => [
  state,
  (dispatch) => {
    addEventListener('dragenter', event => { event.preventDefault(); });
    addEventListener('dragover', event => { event.preventDefault(); });
    addEventListener('drop', event => {
      event.preventDefault();
      // a book is a .txt file; some systems hand one over without a type, so the name decides
      let dropped = [...event.dataTransfer.files];
      let files = dropped.filter(file => /\.txt$/i.test(file.name));
      let ignored = dropped.filter(file => !files.includes(file));
      if (ignored.length) console.info('Not a .txt book, left out:', ignored.map(file => file.name));
      if (files.length) dispatch(StoreFiles, { files });
    });
  }
];

let StoreFilesDone = (state, { files }) => [
  state,
  async (dispatch) => {
    //refresh recent books in state
    dispatch(LoadRecentBooks);

    let books = files.map(file => Book(file));

    let booksOpenInNewTab = books;
    let bookOpenInCurrentTab = null;
    if(state.book) {
      //if this book is already open, open other files in new tabs
      bookOpenInCurrentTab = books.find(book => (book.id == state.book.id));
      booksOpenInNewTab = books.filter(book => (book != bookOpenInCurrentTab));
    } else {
      //if no book is open, open the first file in current tab, other files in new tabs
      [bookOpenInCurrentTab, ...booksOpenInNewTab] = books;
    }

    //resolve every chapter up front: an await between two window.open calls loses the
    //drop's user activation, so every tab after the first gets blocked by the popup blocker
    let progress = await state.backend.progress();
    let positions = new Map(books.map(book => {
      let { offset, chapterId } = progress[book.id] || {};
      return [book.id, { bookId: book.id, offset, chapterId }];
    }));

    let blocked = booksOpenInNewTab.filter(book => (
      !window.open(state.router.route(bookRoute(positions.get(book.id))), '_blank')
    ));
    if (blocked.length) {
      console.info('Blocked by the popup blocker, opened in the library only:', blocked.map(book => book.name));
    }

    if(bookOpenInCurrentTab) {
      let book = bookOpenInCurrentTab;
      let position = positions.get(book.id);
      state.router.push(bookRoute(position));
      dispatch(OpenBook, position);
    }
  }
];
let StoreFiles = (state, { files: localFiles }) => [
  state,
  async (dispatch) =>  {
    let readFile = (localFile) => new Promise(resolve => {
      let reader = new FileReader();
      reader.addEventListener('load', event => {
        resolve({ name: localFile.name, size: localFile.size, text: event.target.result });
      });
      reader.readAsText(localFile);
    });

    let files = [];
    for (let localFile of localFiles) {
      files.push(await readFile(localFile));
    }

    dispatch(StoreBooks, { files, onSuccess: [StoreFilesDone, { files }] });
  },
];

// `files` are [{ name, size, text }]
let StoreBooks = (state, { files, onSuccess }) => [
  state,
  async (dispatch) => {
    await state.backend.addBooks(files);
    if (onSuccess) dispatch(...onSuccess);
  }
];

// the book read again, and opened where the reader is
let RefreshBook = (state, { bookId }) => [
  state,
  async (dispatch) => {
    if (!bookId) {
      console.info('Failed to load file:', { bookId });
      return;
    }
    if (!await state.backend.rereadBook(bookId)) return;
    dispatch(OpenBook, { bookId, offset: state.chapter.offset, chapterId: state.chapter.id });
  }
];

let DeleteBookDone = (state, { bookId }) => ({ ...state, files: state.files.filter(file => Book(file).id != bookId) });
let DeleteBook = (state, { bookId }) => [
  state,
  async (dispatch) => {
    await state.backend.deleteBook(bookId);
    dispatch(DeleteBookDone, { bookId });
  }
];

let ShowRecentBooks = (state) => {
  if (!state.book) return state;
  return [
    { ...state, book: null, chapter: null },
    (dispatch) => {
      clearTimeout(window.saveProgressTimer);
      state.router.push({});
      document.title = 'Text Reader';
      requestAnimationFrame(() => {
        scroll(0, 0);
      });
      dispatch(ToggleCommandPalette, { open: false });
    }
  ];
};

let sizeFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', style: 'unit', unit: 'byte', unitDisplay: 'narrow' });
let formatSize = sizeFormatter.format.bind(sizeFormatter);

let dateFormatter = new Intl.RelativeTimeFormat();
let formatDate = (iso) => {
  if(!iso) return;
  let diff = (Date.now () - new Date(iso)) / 1000;
  for (let [unit, seconds] of Object.entries({
    months: 30 * 24 * 60 * 60,
    days: 24 * 60 * 60,
    hours: 60 * 60,
    minutes: 60,
    seconds: 0,
  })) {
    if (diff >= seconds) return dateFormatter.format(-Math.round(diff / (seconds || 1)), unit);
  }
};

app({
  init: [
    {
      router: new HashRouter(),
      backend: null,
      files: [],
      book: null,
      chapter: null,
      progress: {},
      settings: {
        sort: {
          field: 'updatedAt',
          direction: 'desc'
        }
      },
      commandPalette: {
        open: false,
        q: '',
        selectedIndex: 0,
      },
      fontPicker: {
        open: false,
        q: '',
        target: 'reading',
      },
      namesEditor: {
        open: false,
        names: '',
        addName: null,
        form: {
          names: '',
        },
      },
    },
    (dispatch) => {
      dispatch(InitRouter);
      dispatch(InitTheme);
      dispatch(InitBackend);
      dispatch(InitDropzone);
    }
  ],
  dispatch: (dispatch) => {
    return (action, payload) => {
      if (!action) return;

      if (typeof action === 'function' && action.name.match(/^[A-Z]/)) {
        let log = [action.name];
        if (payload !== undefined) log.push(payload);
      }

      dispatch(action, payload);
    };
  },
  subscriptions: () => [
    [InitKeyboardNavigator],
    [InitCommandPalette],
    [InitFontPicker],
    [InitAddNameButton],
    [InitReadingOffset],
  ],
  node: document.body,
  view: ({ router, files, book, chapter, progress, settings, commandPalette, namesEditor, fontPicker }) => {
    let fixNames = text => correctNames(text, namesEditor.names);
    let commands = [];
    let selectedCommand;
    if(!book) {
      commands = simpleCache({
        key: 'commands/books',
        fallbackValue: [],
        getHash() { return files.length; },
        getValue() {
          return files.map(file => {
            let book = Book(file);
            let { offset, chapterId } = (progress[book.id] || {});
            return {
              label: book.name,
              action: OpenBook,
              payload: { bookId: book.id, offset, chapterId },
              term: latinize(book.name).toLowerCase(),
            };
          });
        },
      });
    } else {
      commands = simpleCache({
        key: 'commands/books/' + book.id,
        fallbackValue: [],
        getHash() {
          let file = files.find(f => Book(f).id == book.id);
          // the labels are corrected names, so a name edit changes them
          return [file.size, namesEditor.names].join('/');
        },
        getValue() {
          return book.chapters.map(chapter => {
            let label = fixNames(chapter.title);
            return {
              label,
              action: OpenBook,
              payload: { bookId: book.id, offset: chapter.offset },
              // searchable under both spellings, corrected and original
              term: latinize([label, chapter.title].join(' | ')).toLowerCase(),
            };
          });
        },
      });
    }
    commands = commands.filter(cmd => cmd.term.includes(commandPalette.q)) ?? [];
    selectedCommand = commands[(commandPalette.selectedIndex + commands.length) % commands.length];
    // sizes and weights are read back as numbers, so a setting can only ever land
    // in the stylesheet as one
    let typography = [
      settings.font && `--reading-font: ${cssFontFamily(settings.font)}, Reader;`,
      settings.fontSize && `--reading-font-size: ${Number(settings.fontSize)}pt;`,
      settings.fontWeight && `--reading-font-weight: ${Number(settings.fontWeight)};`,
      settings.uiFont && `--ui-font: ${cssFontFamily(settings.uiFont)}, Reader;`,
      settings.uiFontSize && `--ui-font-size: ${Number(settings.uiFontSize)}pt;`,
      settings.uiFontWeight && `--ui-font-weight: ${Number(settings.uiFontWeight)};`,
    ].filter(Boolean).join(' ');
    // the sliders follow the same toggle the list does
    let currentGroup;
    let picked = fontSettings[fontPicker.target];
    let pickedFont = settings[picked.family];
    let pickedSize = settings[picked.size] || 18;
    let pickedWeight = settings[picked.weight] || 400;
    return (
      h('body', {}, [
        typography && h('style', {}, text(`:root { ${typography} }`)),
        h('nav', {}, [
          (book?.chapters?.length > 0) && (
            h('ol', { start: 0 }, [
              ...book.chapters.flatMap((c, i) => {
                let link = (label, tip) => h('a', {
                  href: router.route(bookRoute({ bookId: book.id, offset: c.offset })),
                  onclick: (_, event) => {
                    event.preventDefault();
                    return [OpenBook, { bookId: book.id, offset: c.offset }];
                  },
                  title: fixNames(tip),
                }, [
                  text(fixNames(label))
                ]);
                return [
                  // only the chapter that names its book opens a group: the ones after it
                  // belong to it until another book is named
                  c.group && c.group != currentGroup && h('li', { class: 'book' }, text(currentGroup = c.group)),
                  // a chapter in parts is named once, over its parts; the name opens the first
                  c.part && c.part.of != book.chapters[i - 1]?.part?.of && h('li', {}, [link(c.part.of, c.part.of)]),
                  h('li', { class: { active: c.id == chapter.id, part: !!c.part } }, [link(c.part ? c.part.text : c.title, c.title)]),
                ].filter(Boolean);
              })
            ])
          )
        ]),
        !book && (
          h('div', { class: 'table' }, [
            h('a', {
              class: 'th text-left',
              'data-sort': settings.sort.field === 'name' && settings.sort.direction,
              href: '#',
              onclick: (_, event) => {
                event.preventDefault();
                let field = 'name', direction = 'asc';
                if ((settings.sort.field == field) && (settings.sort.direction == direction)) direction = ['asc', 'desc'].find(d => d != direction);
                return [SaveSettings, { sort: { field, direction } }];
              }
            }, h('span', {}, text('File'))),
            h('a', {
              class: 'th text-right',
              'data-sort': settings.sort.field === 'size' && settings.sort.direction,
              href: '#',
              onclick: (_, event) => {
                event.preventDefault();
                let field = 'size', direction = 'asc';
                if ((settings.sort.field == field) && (settings.sort.direction == direction)) direction = ['asc', 'desc'].find(d => d != direction);
                return [SaveSettings, { sort: { field, direction } }];
              }
            }, h('span', {}, text('Size'))),
            h('a', {
              class: 'th text-right',
              'data-sort': settings.sort.field === 'chapterCount' && settings.sort.direction,
              href: '#',
              onclick: (_, event) => {
                event.preventDefault();
                let field = 'chapterCount', direction = 'asc';
                if ((settings.sort.field == field) && (settings.sort.direction == direction)) direction = ['asc', 'desc'].find(d => d != direction);
                return [SaveSettings, { sort: { field, direction } }];
              }
            }, h('span', {}, text('Chapters'))),
            h('a', {
              class: 'th text-right',
              'data-sort': settings.sort.field === 'updatedAt' && settings.sort.direction,
              href: '#',
              onclick: (_, event) => {
                event.preventDefault();
                let field = 'updatedAt', direction = 'desc';
                if ((settings.sort.field == field) && (settings.sort.direction == direction)) direction = ['asc', 'desc'].find(d => d != direction);
                return [SaveSettings, { sort: { field, direction } }];
              }
            }, h('span', {}, text('Date'))),
            h('span', { class: 'th' }, h('span', {})),
            ...files.sort((a, z) => {
              let { field, direction } = settings.sort;
              let A = Book(a), Z = Book(z);
              let result;
              if (field === 'name') {
                result = A.name.localeCompare(Z.name, 'vi-VN', { sensitivity: 'accent' });
              } else if (field === 'size') {
                result = a[field] - z[field];
              } else if (field === 'updatedAt') {
                a = new Date(progress[A.id]?.[field] || 0);
                z = new Date(progress[Z.id]?.[field] || 0);
                result = a - z;
              } else if (field === 'chapterCount') {
                result = (progress[A.id]?.[field] || 1) - (progress[Z.id]?.[field] || 1);
              }
              if ((direction === 'desc') && (result !== 0)) result = -result;
              return result;
            }).flatMap(file => {
              let book = Book(file);
              let { offset, chapterId, chapterIndex, chapterCount, updatedAt } = (progress[book.id] || {});
              return [
                h('div', { class: 'td' }, [
                  h('a', {
                    class: 'name',
                    href: router.route(bookRoute({ bookId: book.id, offset, chapterId })),
                    onclick: (_, event) => {
                      event.preventDefault();
                      return [OpenBook, { bookId: book.id, offset, chapterId }];
                    }
                  }, [
                    text(book.name)
                  ]),
                  book.description && (
                    h('small', { class: 'desc' }, text(book.description))
                  )
                ]),
                h('div', { class: 'td text-right' }, [
                  h('small', {}, text(formatSize(file.size)))
                ]),
                h('div', { class: 'td text-right' }, [
                  h('small', {}, text(!chapterCount ? '-' : `${chapterIndex}/${chapterCount}`))
                ]),
                h('div', { class: 'td text-right' }, [
                  h('small', {}, text(formatDate(updatedAt) || '-'))
                ]),
                h('div', { class: 'td' }, [
                  h('a', { class: 'delete', onclick: [DeleteBook, { bookId: book.id }] }, [
                    h('small', {}, text('delete'))
                  ])
                ])
              ]
            })
          ])
        ),
        chapter && (
          h('main', {}, [
            h('article', {}, [
              ...chapterLines(chapter, fixNames).map(({ text: line, offset }) => {
                if (/^[-]+$/.test(line)) return h('hr', { 'data-offset': offset });
                if (/^[^\p{L}\p{N}"]+$/u.test(line)) return h('p', { 'data-offset': offset, class: 'text-center indent-none' }, text(line));
                let content = [], m;
                while ((m = /https?:\/\/\S+/.exec(line))) {
                  if (m.index > 0) content.push(text(line.slice(0, m.index)));
                  content.push(h('a', { href: m[0], target: '_blank' }, [text(m[0])]));
                  line = line.slice(m.index + m[0].length);
                }
                if (line) content.push(text(line));
                return h('p', { 'data-offset': offset }, content);
              })
            ])
          ])
        ),
        h('aside', { class: 'settings' }, [
          chapter && (
            h('div', {}, [
              h('a', {
                class: 'close',
                href: router.route({}),
                onclick: (_, event) => {
                  event.preventDefault();
                  return [ShowRecentBooks];
                },
                title: 'Back to bookshelf',
              })
            ])
          ),
          h('div', { class: 'colors' }, ['white', 'sepia', 'gray', 'night', 'rose-pine', 'rose-pine-moon', 'rose-pine-dawn', 'solarized', 'kiselevka', 'gruvbox'].map(color => (
            h('button', {
              class: [color, { 'checked:light': settings['color:light'] == color, 'checked:dark': settings['color:dark'] == color }],
              onclick: () => [MultipleActions, [
                [SaveSettings, { [`color:${getColorScheme()}`]: color }],
                [HighlightNames],
              ]],
              title: `Theme: ${color}`,
            })
          ))),
          h('div', { class: 'paper-size' }, ['sm', 'md', 'lg', 'xl'].map(size => (
            h('button', {
              class: ['size', size, { selected: settings.paperSize == size }],
              onclick: [SaveSettings, { paperSize: size }],
              title: `Page size: ${size}`,
            }, text(size))
          ))),
          h('div', {}, [
            h('button', {
              class: 'font',
              onclick: [ToggleFontPicker, { open: true }],
              title: 'Fonts and sizes',
            }),
          ]),
          chapter && (
            h('div', {}, [
              h('button', {
                class: 'refresh',
                onclick: [RefreshBook, { bookId: book.id }],
                title: 'Refresh book',
              }),
              h('button', {
                class: 'zen',
                onclick: [SaveSettings, { zen: !settings.zen }],
                title: 'Toggle Zen Mode',
              }),
              h('button', {
                class: 'names-editor',
                onclick: [ToggleNamesEditor, { open: true }],
                title: 'Edit names',
              }),
            ])
          )
        ]),
        h('dialog', { id: 'command-palette', open: commandPalette.open }, [
          h('form', {
            onsubmit: (_, event) => {
              event.preventDefault();
              return [MultipleActions, [
                [selectedCommand.action, selectedCommand.payload],
                [ToggleCommandPalette, { open: false }],
              ]];
            }
          }, [
            h('input', {
              oninput: (_, event) => [MultipleActions, [
                [SetCommandQuery, event.target.value],
                [SelectCommand, 0],
                [HighlightMatches],
                [HighlightNames, commandPaletteNames],
              ]],
            }),
            h('input', { type: 'submit', hidden: true }),
          ]),
          //commandPalette.q && h('style', {}, text(`#command-palette [data-term]:not([data-term*="${commandPalette.q}"]) { display: none; }`)),
          commands.length > 0 && h('ul', {}, [
            ...commands.map((command, index) => (
              h('li', {
                'data-term': command.term,
                class: { selected: command == selectedCommand }
              },
                h('a', {
                  href: router.route(bookRoute(command.payload)),
                  onclick: (_, event) => {
                    event.preventDefault();
                    return [MultipleActions, [
                      [SelectCommand, index],
                      [command.action, command.payload],
                      [ToggleCommandPalette, { open: false }],
                    ]]
                  },
                  title: command.label,
                },[
                  text(command.label),
                ])
              )
            ))
          ])
        ]),
        h('dialog', { id: 'font-picker', open: fontPicker.open }, [
          h('div', { class: 'target' }, [
            ...['reading', 'ui'].map(target => (
              h('button', {
                class: { selected: fontPicker.target == target },
                onclick: [SetFontTarget, target],
                title: target === 'reading'
                  ? 'The font the paragraphs are set in'
                  : 'The font everything else is set in',
              }, text(target === 'reading' ? 'Reading' : 'Interface'))
            ))
          ]),
          h('input', {
            placeholder: 'Font',
            value: fontPicker.q,
            oninput: (_, event) => [SetFontQuery, event.target.value],
          }),
          settings.fonts?.length > 0
            ? h('small', {}, [
                text(`${settings.fonts.length} fonts. `),
                h('a', { onclick: [LoadFonts, { force: true }] }, text('Look again'))
              ])
            : h('small', {}, text('These are the fonts this page can name without asking. To pick from everything installed, open it over http://localhost - chrome will not remember the permission for a file:// page.')),
          h('ul', {}, [
            h('li', {}, [
              h('button', {
                class: { selected: !pickedFont },
                onclick: [ChooseFont, ''],
              }, text('Default'))
            ]),
            ...(settings.fonts?.length > 0 ? settings.fonts : readingFonts)
              .filter(family => family.toLowerCase().includes(fontPicker.q.trim().toLowerCase()))
              .map(family => (
                h('li', {}, [
                  h('button', {
                    class: { selected: pickedFont == family },
                    // the name written in the face itself, which is the only way
                    // to tell whether it is one to read a book in
                    style: { fontFamily: cssFontFamily(family) },
                    onclick: [ChooseFont, family],
                  }, text(family))
                ])
              ))
          ]),
          h('label', {}, [
            text('Size'),
            h('input', {
              type: 'range',
              min: 10, max: 32, step: 0.5,
              value: pickedSize,
              oninput: (_, event) => [ApplySettings, { [picked.size]: Number(event.target.value) }],
              onchange: (_, event) => [SaveSettings, { [picked.size]: Number(event.target.value) }],
            }),
            h('span', {}, text(`${pickedSize}pt`)),
          ]),
          h('label', {}, [
            text('Weight'),
            h('input', {
              type: 'range',
              min: 100, max: 900, step: 100,
              value: pickedWeight,
              oninput: (_, event) => [ApplySettings, { [picked.weight]: Number(event.target.value) }],
              onchange: (_, event) => [SaveSettings, { [picked.weight]: Number(event.target.value) }],
            }),
            h('span', {}, text(pickedWeight)),
          ]),
        ]),
        h('dialog', { id: 'names-editor', open: namesEditor.open }, [
          h('form', {
            onsubmit: (_, event) => {
              event.preventDefault();
              return [MultipleActions, [
                [ToggleNamesEditor, { open: false }],
                [SaveNames, { bookId: book.id, names: namesEditor.names }],
                [HighlightNames],
              ]];
            }
          }, [
            h('textarea', {
              value: namesEditor.names,
              oninput: (_, event) => [SetNames, event.target.value],
              onkeydown: (_, event) => {
                if (event.key === 'Escape') {
                  return [ToggleNamesEditor, { open: false }];
                } else if (event.key === 'Enter' && event.metaKey) {
                  return [MultipleActions, [
                    [ToggleNamesEditor, { open: false }],
                    [SaveNames, { bookId: book.id, names: namesEditor.names }],
                    [HighlightNames],
                  ]];
                }
              },
            }),
            h('button', { type: 'submit' }, [text('Save')]),
          ])
        ]),
        namesEditor.addName && (
          h('div', {
            id: 'add-name',
            style: {
              // it grows upwards, so every row above the last needs room over the name
              top: `${Math.max(namesEditor.addName.top, 30 + namesEditor.addName.aliases.length * 24)}px`,
              left: `${namesEditor.addName.left}px`,
            },
            // keep the selection and the button alive long enough to be clicked
            onmousedown: (state, event) => (event.preventDefault(), state),
          }, [
            // a name made of words of a name already listed is most likely that
            // person under another name, so offer them before a new entry. A
            // relationship is nobody's name, so the rows are who it is said of
            ...namesEditor.addName.aliases.map(canonical => h('button', {
              onclick: [AddName, {
                name: namesEditor.addName.name,
                alias: canonical,
                relationship: namesEditor.addName.relationship,
              }],
              title: namesEditor.addName.relationship
                ? `Add ${namesEditor.addName.name} as what ${canonical} is called`
                : `Add ${namesEditor.addName.name} as another name of ${canonical}`,
            }, text(`+ ${canonical}`))),
            h('button', {
              onclick: [AddName, {
                name: namesEditor.addName.name,
                relationship: namesEditor.addName.relationship,
              }],
              title: 'Add to names list',
              // shown the way it is stored, so the parens are no surprise later
            }, text(namesEditor.addName.relationship
              ? `+ (${namesEditor.addName.name.toLowerCase()})`
              : `+ ${namesEditor.addName.name}`)),
          ])
        )
      ])
    );
  }
});


// @worker:begin - what the tests load of the page, with a stand-in for the worker
// Reading a book takes a while when it is big, so it is done in a worker, made from the
// parser's own script, and the page stays where it was. Where no worker can be made, or
// one fails, the page reads the book itself.
let parserWorker;
let reading = new Map();   // id -> { name, text, resolve }
let readings = 0;

// which way a book was read is said in the console, so a page opened from a file can tell
function readInPage(name, text, why) {
  console.info(`Chapters of "${name}": read in the page (${why})`);
  return extractChapters(name, normalizeFileContent(text), { name });
}

function startParserWorker() {
  try {
    let glue = `
      self.onmessage = ({ data: { id, name, text } }) => {
        try { postMessage({ id, chapters: extractChapters(name, normalizeFileContent(text), { name }) }); }
        catch (error) { postMessage({ id, error: String(error?.message ?? error) }); }
      };`;
    let source = PARSER_SOURCE + glue;
    let worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    worker.onmessage = ({ data: { id, chapters, error } }) => {
      let job = reading.get(id);
      reading.delete(id);
      if (error) job?.resolve(readInPage(job.name, job.text, `the worker failed: ${error}`));
      else {
        console.info(`Chapters of "${job?.name}": read in a worker`);
        job?.resolve(chapters);
      }
    };
    // a worker that cannot run leaves its books to the page
    worker.onerror = () => {
      worker.terminate();
      parserWorker = null;
      for (let job of reading.values()) job.resolve(readInPage(job.name, job.text, 'the worker could not run'));
      reading.clear();
    };
    return worker;
  } catch (error) {
    console.info('No worker for the parser:', error);
    return null;
  }
}

// the chapters of a book's text
function chaptersOf(name, text) {
  parserWorker ??= startParserWorker();
  if (!parserWorker) return Promise.resolve(readInPage(name, text, 'no worker could be made'));
  return new Promise(resolve => {
    let id = ++readings;
    reading.set(id, { name, text, resolve });
    parserWorker.postMessage({ id, name, text });
  });
}

// a book with its text read: the file, and its chapters
async function readBook(file, fileContent) {
  let book = Book(file);
  book.chapters = await chaptersOf(book.name, fileContent);
  return book;
}
// @worker:end

// ---- Backends -----------------------------------------------------------------------
// What keeps the books, where each was left and the settings, and reads a book into its
// chapters. The page asks it, and does not mind which it is. Every call is async:
//   settings()                  every setting, as { key: value }
//   saveSettings(settings)      some of them
//   progress()                  where each book was left, as { bookId: record }
//   saveProgress(id, record)
//   names(id)                   the names corrected in a book, as text (or undefined)
//   saveNames(id, text)
//   files()                     the books kept, as the files they came from: [{ name, size }]
//   addBooks(files)             read and keep [{ name, size, text }]; their records
//   book(id)                    the record of a book (bookRecord), read again first if an
//                               older parser read it; null for a book not kept
//   chapter(id, listed)         a chapter of the record, with its text; null if it is gone
//   rereadBook(id)              read a kept book again; its record, or null
//   deleteBook(id)
//
// Served by the server (`node server/server.js`), the page leaves its books to the server;
// opened as a file, or served by anything else, it keeps them in the browser. The two keep
// books apart: a book dropped on one is not in the other.
async function chooseBackend() {
  if (location.protocol.startsWith('http')) {
    try {
      let hello = await fetch('api/hello');
      if (hello.ok && (await hello.json()).backend === 'server') {
        console.info('Books kept by the server');
        return serverBackend();
      }
    } catch (error) {
      console.info('No server to keep the books, the browser keeps them:', error);
    }
  }
  return browserBackend();
}

// the server's: it reads the books and keeps them (see server/server.js for its answers)
function serverBackend() {
  // a body is sent as JSON, or as text when it is text; an answer of 404 is null
  let call = async (method, route, body) => {
    let text = typeof body === 'string';
    let response = await fetch(`api/${route}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': text ? 'text/plain; charset=utf-8' : 'application/json' },
      body: body === undefined || text ? body : JSON.stringify(body),
    });
    // the answer is read whole, whatever it is: one left unread holds its connection, and
    // the next call over it is cut off
    let answer = response.headers.get('content-type')?.startsWith('application/json') ? await response.json() : await response.text();
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`${method} api/${route}: ${response.status} ${answer}`);
    return response.status === 204 ? undefined : answer;
  };
  let id = encodeURIComponent;
  return {
    settings: () => call('GET', 'settings'),
    saveSettings: (settings) => call('PATCH', 'settings', settings),
    progress: () => call('GET', 'progress'),
    saveProgress: (bookId, record) => call('PUT', `progress/${id(bookId)}`, record),
    names: (bookId) => call('GET', `names/${id(bookId)}`),
    saveNames: (bookId, text) => call('PUT', `names/${id(bookId)}`, text),
    files: () => call('GET', 'files'),
    addBooks: (files) => Promise.all(files.map(file => call('POST', 'books', file))),
    book: (bookId) => call('GET', `books/${id(bookId)}`),
    chapter: (bookId, listed) => call('GET', `books/${id(bookId)}/chapters/${id(listed.id)}`),
    rereadBook: (bookId) => call('POST', `books/${id(bookId)}/reread`),
    deleteBook: (bookId) => call('DELETE', `books/${id(bookId)}`),
  };
}

// the browser's: IndexedDB, and the parser in a worker (see readBook)
async function browserBackend() {
  let db = await openDB('text-reader', 23, {
    upgrade(db, oldVersion, newVersion, transaction, events) {
      console.log('upgrade db', { oldVersion, newVersion, transaction, events });
      let stores = ['files', 'fileContents', 'settings', 'progress', 'books', 'chapters', 'names'];
      for (let store of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    },
    blocked: console.log,
    blocking: console.log,
    terminated: console.log,
  });
  // a store as { key: value }
  let everything = async (store) => {
    let found = {};
    for (let cursor = await db.transaction(store).store.openCursor(); cursor; cursor = await cursor.continue()) {
      found[cursor.key] = cursor.value;
    }
    return found;
  };
  let backend = {
    settings: () => everything('settings'),
    async saveSettings(settings) {
      let tx = db.transaction('settings', 'readwrite');
      await Promise.all([...Object.entries(settings).map(([key, value]) => tx.store.put(value, key)), tx.done]);
    },
    progress: () => everything('progress'),
    saveProgress: (id, record) => db.put('progress', record, id),
    names: (id) => db.get('names', id),
    saveNames: (id, text) => db.put('names', text, id),
    files: () => db.getAll('files'),
    async addBooks(files) {
      let chapterKeys = await db.getAllKeys('chapters');
      // the books are read before the transaction opens: it would not wait for them
      let read = await Promise.all(files.map(async ({ name, size, text }) => ({ file: { name, size }, text, book: await readBook({ name, size }, text) })));
      let tx = db.transaction(['files', 'fileContents', 'books', 'chapters'], 'readwrite');
      await Promise.all([
        ...read.flatMap(({ file, text, book }) => [
          tx.objectStore('files').put(file, book.id),
          tx.objectStore('fileContents').put(text, book.id),
          tx.objectStore('books').put(bookRecord(book), book.id),
          ...chapterKeys.filter(k => k.startsWith(`${book.id}/`)).map(k => tx.objectStore('chapters').delete(k)),
          ...book.chapters.map(c => tx.objectStore('chapters').put(c, `${book.id}/${c.id}`)),
        ]),
        tx.done,
      ]);
      return read.map(({ book }) => bookRecord(book));
    },
    async book(id) {
      let book = await db.get('books', id);
      // a book stored by an older parser keeps the titles and groups that parser cut it
      // into, and one stored before chapters carried their offset has none: reading the
      // file again is what updates them
      let stale = !book || book.parser !== PARSER_VERSION || !book.chapters.some(c => c.offset != null);
      if (!stale) return book;
      console.info('Book read again:', { id, parser: book?.parser });
      return backend.rereadBook(id);
    },
    async chapter(id, listed) {
      let chapter = await db.get('chapters', `${id}/${listed.id}`);
      // the book record is the one that places the chapter, so it holds the offset
      return chapter && { ...chapter, offset: listed.offset };
    },
    async rereadBook(id) {
      let [file, text] = await Promise.all([db.get('files', id), db.get('fileContents', id)]);
      if (!file || !text) {
        console.info('File not found:', { id });
        return null;
      }
      let [book] = await backend.addBooks([{ ...file, text }]);
      return book;
    },
    async deleteBook(id) {
      let chapterKeys = (await db.getAllKeys('chapters')).filter(k => k.startsWith(`${id}/`));
      let tx = db.transaction(['files', 'fileContents', 'books', 'chapters'], 'readwrite');
      await Promise.all([
        tx.objectStore('files').delete(id),
        tx.objectStore('fileContents').delete(id),
        tx.objectStore('books').delete(id),
        ...chapterKeys.map(k => tx.objectStore('chapters').delete(k)),
        tx.done,
      ]);
    },
  };
  return backend;
}

function getColorScheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) return 'dark';
  return 'light';
}

function buildRegex(patterns, placeholders, flags) {
  patterns = patterns.filter(Boolean).map((p, i) => `(?<Case${i+1}>${p.source || p})`).join('|');
  let counts = Object.fromEntries(Object.keys(placeholders).map(k => [k, 0]));
  for(let i = 1; i <= 10; i++) {
    for(let [p, r] of Object.entries(placeholders)) {
      patterns = patterns.replaceAll(`{${p}}`, () => `(?<${p}${++counts[p]}>${r.source || r})`);
    }
  }
  return new RegExp(patterns, flags);
}

function simpleCache({ key, getValue, getHash, fallbackValue }) {
  try {
    let cache = globalThis.__simpleCache || (globalThis.__simpleCache = {});
    let hash = getHash();
    if (!(key in cache) || cache[key].hash != hash) {
      cache[key] = { value: getValue(), hash };
    }
    return cache[key].value;
  } catch {
    return fallbackValue;
  }
}

function titleCase(s) {
  return s.toLowerCase().replace(/(?<=^|[^\p{L}])./gu, c => c.toUpperCase());
}

function memoize(f) {
  let memoized = _.memoize(f, (...args) => JSON.stringify(args));
  globalThis[f.name] = memoized;
  return memoized;
}

function getCase(word) {
  if (word == word.toUpperCase()) return 'upper';
  if (word == word.toLowerCase()) return 'lower';
  if (word[0] == word[0].toUpperCase()) return 'title';
}

function toCase(word, _case) {
  if (_case === 'upper') return word.toUpperCase();
  if (_case === 'lower') return word.toLowerCase();
  if (_case === 'title') return titleCase(word);
  return word;
}

memoize(function useCase(src, dst) {
  if (getCase(src) === 'lower' && getCase(dst) === 'lower') return titleCase(dst);
  let srcWords = src.split(' ');
  let dstWords = dst.split(' ');
  if (srcWords.length == dstWords.length) {
    let cases = srcWords.map((srcWord, i) => {
      if (getCase(srcWord) != getCase(dstWords[i])) return getCase(dstWords[i]);
    });
    return function applyCase(s) {
      return s.split(' ').map((word, i) => toCase(dstWords[i], cases[i] || getCase(word))).join(' ');
    }
  }
  return dst;
});

memoize(function hashCode(str) {
  let hash = 0;
  if (str.length === 0) return hash;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
    hash = hash & hash;
  }
  return hash;
});
