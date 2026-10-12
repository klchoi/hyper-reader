// What the page knows, and everything it does: the book open, the chapter, the library, where
// each book was left, the settings, the dialogs, the names. Each is a tracked value the
// components read; the actions below are the only ones that write them. Made once, by App,
// while it is set up (tracked values belong to a component), and handed down as a context.
import { Context, tick, track } from 'ripple';
import type { Tracked } from 'ripple';
import { chooseBackend } from './backends.ts';
import type { Backend, BookRecord, BookSaying, BookSummary, FileInfo, LibraryStatus, Mention, Person, Progress } from './backends.ts';
import { articleNames, commandPaletteNames, highlightNames, nameFixer, namesWith, offerFor } from './names.ts';
import type { AddNameAt, AddNameOffer } from './names.ts';
import { bookRoute, chapterAt, createRouter, getColorScheme, markFound, nextTick, toOffset } from './places.ts';
import type { Chapter, Listed, Route } from './places.ts';
import { latinize } from './parser.ts';
import type { Reader } from './reading.ts';

// what the page is given to start with: the reader of books (see reading.ts)
export type Page = { reader: Reader };

// the most books or chapters the palette lists at once
const LISTED = 200;

export type Settings = Record<string, any>;
// what the palette offers: a book, a chapter, or a place in the book that says what was typed
export type Command = { key: string; label: string; term: string; open: { bookId: string; offset?: number; chapterId?: string }; mention?: Mention };

// a font name reaches css as a quoted family, so a name is only ever read as
// a name - and Reader stays behind it for whatever the chosen face is missing
export const cssFontFamily = (family: string) => `"${family.replace(/["\\]/g, '')}"`;
// the book and the chrome are set independently, and the panel switches between
// the two sets of the same three settings rather than growing a second row of them
export const fontSettings = {
  reading: { family: 'font', size: 'fontSize', weight: 'fontWeight' },
  ui: { family: 'uiFont', size: 'uiFontSize', weight: 'uiFontWeight' },
} as const;
export type FontTarget = keyof typeof fontSettings;
// only chromium will say which fonts are installed, and only when the reader
// asks. Everywhere else a page can name a face but never learn what is there,
// so the list falls back to the ones worth reading a book in
export const readingFonts = [
  'Source Serif 4', 'Iowan Old Style', 'Charter', 'Palatino', 'Baskerville',
  'Hoefler Text', 'Georgia', 'Literata', 'Cambria', 'Constantia',
  'Times New Roman', 'system-ui',
];

// a setting css can select on goes on the element. A list or a shape is for the
// app to read and only reads as junk in an attribute, so it stays out of one
function applyDataset(key: string, value: unknown) {
  if (value != null && typeof value === 'object') return;
  document.documentElement.dataset[key] = String(value ?? '');
}

export function createStore({ reader }: Page) {
  const router = createRouter();
  let backend: Backend;

  const books = track<BookSummary[]>([]);
  const book = track<BookRecord | null>(null);
  const chapter = track<Chapter | null>(null);
  // the chapter asked for, while its text is on its way: the list shows it as the one read
  const opening = track<string | null>(null);
  const progress = track<Record<string, Progress>>({});
  const settings = track<Settings>({ sort: { field: 'updatedAt', direction: 'desc' } });
  // `text` as typed, `q` as searched for
  const palette = track({ open: false, text: '', q: '', selectedIndex: 0 });
  // the places in the book open that say what the palette was given, and whether the whole book
  // was indexed when asked
  const mentions = track<{ q: string; indexed: boolean; total: number; found: Mention[] }>({ q: '', indexed: true, total: 0, found: [] });
  // what the backend can do beside keeping books: search, and the libraries on its disk
  const searching = track(false);
  const status = track<LibraryStatus | null>(null);
  // the library searched: the characters, and the books that say it
  const found = track<{ q: string; characters: Person[]; books: BookSaying[] }>({ q: '', characters: [], books: [] });
  // the settings panel, and in it the fonts: which of the two the list picks, and its filter
  const settingsOpen = track(false);
  const fontPicker = track<{ q: string; target: FontTarget }>({ q: '', target: 'reading' });
  const names = track('');
  const namesEditorOpen = track(false);
  const addName = track<AddNameOffer | null>(null);
  // the names as the list corrects them, made again only when the list changes
  const fixNames = track(() => nameFixer(names.value));

  // what the command palette offers: the books, or the chapters of the one open, searchable
  // under both spellings of a corrected title
  const bookCommands = track(() => books.value.map(({ id, name }) => {
    let { offset, chapterId } = progress.value[id] || {};
    return { key: `book:${id}`, label: name, open: { bookId: id, offset, chapterId }, term: latinize(name).toLowerCase() };
  }));
  const chapterCommands = track(() => {
    let open = book.value;
    if (!open) return [];
    let fix = fixNames.value;
    return open.chapters.map(listed => {
      let label = fix(listed.title);
      return { key: `chapter:${listed.offset}`, label, open: { bookId: open.id, offset: listed.offset }, term: latinize(`${label} | ${listed.title}`).toLowerCase() };
    });
  });
  const mentionCommands = track<Command[]>(() => {
    let open = book.value;
    if (!open || mentions.value.q !== palette.value.q) return [];
    return mentions.value.found.map(m => ({ key: `at:${m.offset}`, label: `${m.before}${m.match}${m.after}`, term: '', open: { bookId: open.id, offset: m.offset }, mention: m }));
  });
  // the books or chapters named so, of which the palette lists the first LISTED (a library of
  // thousands is narrowed by typing), and the places in the book that say it
  const named = track(() => (book.value ? chapterCommands.value : bookCommands.value).filter(c => c.term.includes(palette.value.q)));
  const commands = track<Command[]>(() => [...named.value.slice(0, LISTED), ...mentionCommands.value]);
  const unlisted = track(() => Math.max(0, named.value.length - LISTED));
  const selectedCommand = track(() => {
    let found = commands.value;
    return found[(palette.value.selectedIndex + found.length) % found.length];
  });

  // ---- settings
  function applySettings(changed: Settings) {
    settings.value = { ...settings.value, ...changed };
    for (let [key, value] of Object.entries(changed)) applyDataset(key, value);
  }
  async function saveSettings(changed: Settings) {
    applySettings(changed);
    await backend.saveSettings(changed);
  }
  async function chooseColor(color: string) {
    await saveSettings({ [`color:${getColorScheme()}`]: color });
    highlight();
  }
  function sortBy(field: string, first: 'asc' | 'desc' = 'asc') {
    let { sort } = settings.value;
    let direction = sort.field === field && sort.direction === first ? (first === 'asc' ? 'desc' : 'asc') : first;
    return saveSettings({ sort: { field, direction } });
  }

  // ---- fonts
  // chrome only remembers the fonts permission per origin, and a file:// page has
  // none to remember it against: allowing it there is allowing it for that one call.
  // So the list is kept once it is given, and asked for again only when asked to be
  async function loadFonts(force = false) {
    if (!force && settings.value.fonts?.length > 0) return;
    let query = (window as any).queryLocalFonts;
    if (!query) return;
    try {
      let installed: { family: string }[] = await query();
      // one entry per face, and a book is read in a family
      let fonts = [...new Set(installed.map(font => font.family))].sort((a, z) => a.localeCompare(z));
      if (fonts.length > 0) await saveSettings({ fonts });
    } catch (error) {
      // refused, or asked for outside the click that opened the picker
      console.warn(error);
    }
  }
  // the settings panel opened, or put away; `open` left out turns it over
  function toggleSettings(open = !settingsOpen.value) {
    if (open === settingsOpen.value) return;
    settingsOpen.value = open;
    if (!open) return;
    fontPicker.value = { ...fontPicker.value, q: '' };
    // queryLocalFonts only answers while the click that opened this still counts
    // as the reader asking, so the list is asked for before waiting on anything
    loadFonts();
  }
  const setFontTarget = (target: FontTarget) => { fontPicker.value = { ...fontPicker.value, target }; };
  const setFontQuery = (q: string) => { fontPicker.value = { ...fontPicker.value, q }; };
  const chooseFont = (font: string) => saveSettings({ [fontSettings[fontPicker.value.target].family]: font });

  // ---- the library
  async function loadBooks() {
    let kept = await backend.books();
    let byName = new Intl.Collator('vi-VN', { sensitivity: 'accent' });
    kept.sort((a, z) => byName.compare(a.name, z.name));
    books.value = kept;
  }
  async function loadProgress() {
    progress.value = await backend.progress();
  }

  // ---- reading
  // a book's progress is saved a while after the reader stops: 10s after a chapter opens, 3s
  // after a scroll
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  function saveProgressLater(open: BookRecord, at: Chapter, offset: number, wait: number) {
    clearTimeout(progressTimer);
    progressTimer = setTimeout(() => saveProgress(open, at, offset), wait);
  }
  async function saveProgress(open: BookRecord, at: Chapter, offset?: number) {
    let record: Progress = {
      ...progress.value[open.id],
      offset: offset ?? at.offset,
      chapterId: at.id,
      chapterIndex: open.chapters.findIndex(c => c.id === at.id) + (open.chapters[0].id ? 1 : 0),
      chapterCount: open.chapters[0].id ? open.chapters.length : open.chapters.length - 1,
      updatedAt: new Date().toISOString(),
    };
    await backend.saveProgress(open.id, record);
    progress.value = { ...progress.value, [open.id]: record };
  }

  // `offset` says where to open, `chapterId` is only what an older bookmark or
  // progress record has instead. Both may be missing, and then the book starts over
  // the latest chapter asked for: one asked for before it, that comes after it, is dropped
  let asked = 0;
  // `fresh`: the book is asked of the backend even when it is the one open (it was read again)
  async function openBook({ bookId, offset, chapterId }: { bookId: string; offset?: unknown; chapterId?: string | null }, { fresh = false } = {}) {
    if (!bookId) {
      console.info('Failed to load file:', { bookId, offset, chapterId });
      return;
    }
    let ask = ++asked;
    let latest = () => ask === asked;
    // nothing to go on means the book starts over
    let listedIn = (record: BookRecord): Listed => chapterAt(record.chapters, offset)
      || record.chapters.find(c => c.id === chapterId)
      || record.chapters[0];

    // the book open is the one asked for again; another is asked of the backend, which reads it
    // again when an older parser read it
    let record = !fresh && book.value?.id === bookId ? book.value : await backend.book(bookId);
    if (!latest()) return;
    if (!record) {
      console.info('Book not found:', { bookId });
      return;
    }
    let listed = listedIn(record);
    opening.value = listed.id;
    let found = await backend.chapter(bookId, listed);
    if (!latest()) return;
    // a record that lists a chapter whose text is gone is read again, once
    if (!found) {
      console.info('Chapter not found:', { bookId, offset, chapterId, id: listed.id });
      record = await backend.rereadBook(bookId);
      if (!latest()) return;
      if (!record) return void (opening.value = null);
      listed = listedIn(record);
      opening.value = listed.id;
      found = await backend.chapter(bookId, listed);
      if (!latest()) return;
      if (!found) return void (opening.value = null);
    }
    // an offset inside the chapter is a place on its page, not just the chapter
    let position = Math.max(toOffset(offset) ?? 0, listed.offset ?? 0);

    let sameBook = book.value?.id === record.id;
    book.value = record;
    chapter.value = found;
    opening.value = null;
    togglePalette(false);
    loadNames(record.id);
    saveProgressLater(record, found, position, 10000);

    let route = bookRoute({ bookId: record.id, offset: position ?? found.offset, chapterId: found.id });
    if (sameBook) router.replace(route);
    else router.push(route);
    document.title = record.name;

    await tick();
    requestAnimationFrame(() => {
      // a link into the middle of a chapter opens where it points
      let paragraphs = [...document.querySelectorAll<HTMLElement>('article [data-offset]')];
      let at = paragraphs.findLast(el => Number(el.dataset.offset) <= position);
      if (at && at !== paragraphs[0]) at.scrollIntoView({ block: 'start' });
      else scroll(0, 0);

      // the open chapter is kept in view in the list
      let active = document.querySelector('nav .active');
      let nav = document.querySelector('nav');
      if (!active || !nav) return;
      let rect = active.getBoundingClientRect();
      if (rect.top < 0 || nav.clientHeight < rect.bottom) active.scrollIntoView({ block: 'center' });
    });
  }
  function openNextChapter(delta: number) {
    let open = book.value;
    // from the chapter asked for last, whether or not it is in yet
    let current = opening.value ?? chapter.value?.id;
    if (!open || !current) return;
    let at = open.chapters.findIndex(c => c.id === current);
    let next = open.chapters[at + delta];
    if (next) openBook({ bookId: open.id, offset: next.offset });
  }
  // the url follows the reader down the page, and the progress a little after
  function trackReadingOffset(offset: number) {
    let open = book.value;
    let at = chapter.value;
    if (!open || !at) return;
    // the page can still be showing the chapter we just left
    if (!(offset >= at.offset && offset <= at.offset + at.content.length)) return;
    if (toOffset(router.current().offset) === offset) return;
    router.replace(bookRoute({ bookId: open.id, offset }));
    saveProgressLater(open, at, offset, 3000);
  }
  async function showLibrary() {
    if (!book.value) return;
    // a chapter on its way is not opened after all
    asked++;
    opening.value = null;
    book.value = null;
    chapter.value = null;
    clearTimeout(progressTimer);
    router.push({});
    document.title = 'Text Reader';
    togglePalette(false);
    await tick();
    requestAnimationFrame(() => scroll(0, 0));
  }

  // ---- books in and out
  // `files` are what was dropped; a book is a .txt file, and the name decides, since some
  // systems hand one over without a type
  async function storeFiles(dropped: File[]) {
    let readFile = (file: File) => new Promise<FileInfo & { text: string }>(resolve => {
      let fileReader = new FileReader();
      fileReader.addEventListener('load', () => resolve({ name: file.name, size: file.size, text: fileReader.result as string }));
      fileReader.readAsText(file);
    });
    let read = [];
    for (let file of dropped) read.push(await readFile(file));
    let added = await backend.addBooks(read);
    loadBooks();
    watchStatus();

    let inNewTabs = added;
    let here: BookRecord | undefined;
    if (book.value) {
      // the book already open opens again here, the others in tabs of their own
      here = added.find(b => b.id === book.value!.id);
      inNewTabs = added.filter(b => b !== here);
    } else {
      // with no book open, the first opens here
      [here, ...inNewTabs] = added;
    }
    // every place is resolved up front: an await between two window.open calls loses the
    // drop's user activation, so every tab after the first gets blocked by the popup blocker
    let kept = await backend.progress();
    let places = new Map(added.map(b => {
      let { offset, chapterId } = kept[b.id] || {};
      return [b.id, { bookId: b.id, offset, chapterId }];
    }));
    let blocked = inNewTabs.filter(b => !window.open(router.route(bookRoute(places.get(b.id)!)), '_blank'));
    if (blocked.length) console.info('Blocked by the popup blocker, opened in the library only:', blocked.map(b => b.name));
    if (here) {
      router.push(bookRoute(places.get(here.id)!));
      await openBook(places.get(here.id)!, { fresh: true });
    }
  }
  // the book read again, and opened where the reader is
  async function refreshBook() {
    let open = book.value;
    let at = chapter.value;
    if (!open || !at) return;
    if (!await backend.rereadBook(open.id)) return;
    await openBook({ bookId: open.id, offset: at.offset, chapterId: at.id }, { fresh: true });
  }
  async function deleteBook(bookId: string) {
    await backend.deleteBook(bookId);
    books.value = books.value.filter(b => b.id !== bookId);
  }

  // ---- names
  function highlight() {
    highlightNames(names.value, articleNames);
  }
  async function loadNames(bookId: string) {
    names.value = (await backend.names(bookId)) ?? '';
    highlight();
  }
  const setNames = (text: string) => { names.value = text; };
  const toggleNamesEditor = (open: boolean) => { namesEditorOpen.value = open; };
  async function saveNames() {
    let open = book.value;
    namesEditorOpen.value = false;
    if (!open) return;
    await backend.saveNames(open.id, `${names.value.trim()}\n`);
    highlight();
  }
  // mousemove and selectionchange fire a lot: the same offer at the same place is left alone
  function showAddName(at: AddNameAt | null) {
    let shown = addName.value;
    if (shown?.name === at?.name && shown?.top === at?.top && shown?.left === at?.left) return;
    addName.value = at && offerFor(names.value, at);
  }
  async function addToNames({ name, alias, relationship }: { name: string; alias?: string; relationship?: boolean }) {
    let open = book.value;
    let listed = open && namesWith(names.value, { name, alias, relationship });
    addName.value = null;
    if (!open || !listed) return;
    names.value = listed;
    getSelection()?.removeAllRanges();
    await backend.saveNames(open.id, `${listed.trim()}\n`);
    highlight();
    highlightNames(names.value, commandPaletteNames);
  }

  // ---- the command palette
  async function togglePalette(open?: boolean, text?: string) {
    let opened = open ?? !palette.value.open;
    if (opened === palette.value.open && text === undefined) return;
    palette.value = { ...palette.value, open: opened };
    if (!opened) return;
    if (text !== undefined) searchCommands(text);
    await nextTick();
    document.querySelector<HTMLInputElement>('#command-palette input')?.select();
    highlightMatches();
    highlightNames(names.value, commandPaletteNames);
  }
  async function selectCommand(index: number) {
    palette.value = { ...palette.value, selectedIndex: index };
    await nextTick();
    // the one selected is kept in view
    let list = document.querySelector('#command-palette ul');
    let item = list?.querySelector<HTMLElement>('li.selected');
    if (!list || !item) return;
    if (item.offsetTop < list.scrollTop) list.scroll({ behavior: 'instant', top: item.offsetTop });
    else if (list.scrollTop + list.clientHeight < item.offsetTop + item.clientHeight) {
      list.scroll({ behavior: 'instant', top: item.offsetTop + item.clientHeight - list.clientHeight });
    }
  }
  // the palette given `text`: the chapters (or books) named so, and in a book every place that
  // says it, asked of the backend a moment after the typing stops
  let mentionsTimer: ReturnType<typeof setTimeout> | undefined;
  async function searchCommands(text: string) {
    let q = text.trim().toLowerCase();
    palette.value = { ...palette.value, text, q, selectedIndex: 0 };
    clearTimeout(mentionsTimer);
    let open = book.value;
    if (open && backend.searchBook && q.length >= 2) {
      mentionsTimer = setTimeout(async () => {
        let { indexed, total, mentions: places } = await backend.searchBook!(text.trim(), open.id);
        if (palette.value.q !== q || book.value?.id !== open.id) return;
        mentions.value = { q, indexed, total, found: places.slice(0, 200) };
        highlightMatches();
        highlightNames(names.value, commandPaletteNames);
      }, 250);
    } else {
      mentions.value = { q, indexed: true, total: 0, found: [] };
    }
    selectCommand(0);
    highlightMatches();
    highlightNames(names.value, commandPaletteNames);
  }
  async function runCommand(command: Command | undefined) {
    if (!command) return;
    let phrase = command.mention?.match;
    togglePalette(false);
    await openBook(command.open);
    // a place in the text: what was searched for is marked there
    markFound(phrase ?? '');
  }
  // what was searched for, marked in each command it was found in
  async function highlightMatches() {
    await nextTick();
    let q = palette.value.q;
    let ranges = [];
    for (let link of document.querySelectorAll('#command-palette a')) {
      let text = link.firstChild;
      if (!text) continue;
      let match = latinize(text.textContent || '').toLowerCase();
      if (!match.includes(q)) continue;
      let start = match.indexOf(q);
      let range = new Range();
      range.setStart(text, start);
      range.setEnd(text, start + q.length);
      ranges.push(range);
    }
    CSS.highlights.set('match', new Highlight(...ranges));
  }

  // ---- the libraries on the server's disk
  // the status asked again every second or so while a scan goes or the index is behind; the
  // books listed again when a scan ends
  let statusTimer: ReturnType<typeof setTimeout> | undefined;
  async function watchStatus() {
    clearTimeout(statusTimer);
    if (!backend.status) return;
    let was = status.value;
    let now = await backend.status();
    status.value = now;
    if (was?.scan.running && !now.scan.running) loadBooks();
    if (now.scan.running || now.index.done < now.index.total) statusTimer = setTimeout(watchStatus, 1500);
  }
  async function rescan() {
    if (!backend.scan) return;
    status.value = await backend.scan();
    watchStatus();
  }
  // the library searched for `text`: the characters named so, and the books that say it
  let foundTimer: ReturnType<typeof setTimeout> | undefined;
  function searchLibrary(text: string) {
    clearTimeout(foundTimer);
    let q = text.trim();
    if (!q || !backend.search || !backend.characters) {
      found.value = { q: '', characters: [], books: [] };
      return;
    }
    found.value = { ...found.value, q };
    foundTimer = setTimeout(async () => {
      let [characters, books] = await Promise.all([backend.characters!(q), backend.search!(q)]);
      if (found.value.q === q) found.value = { q, characters, books };
    }, 250);
  }
  // a book found by a search, opened where it was left, with the places that say it listed
  async function openFound(bookId: string, q: string) {
    let { offset, chapterId } = progress.value[bookId] || {};
    await openBook({ bookId, offset, chapterId });
    togglePalette(true, q);
  }

  // ---- starting
  // the settings, the library and where each book was left are asked of the backend; a link
  // into a book opens it
  async function start() {
    applySettings({ 'color:dark': 'night', 'color:light': 'white' });
    backend = await chooseBackend(reader);
    applySettings(await backend.settings());
    searching.value = !!backend.searchBook;
    loadProgress();
    loadBooks();
    watchStatus();
    // an older link (`/#book=...` on a page that has paths) is written as the page writes it now
    let { book: bookId, offset, chapter: chapterId } = router.current();
    router.replace({ book: bookId, offset, chapter: chapterId });
    if (bookId) openBook({ bookId, offset, chapterId });
  }
  // the reader stepped back or on: back to the library, or into a book
  function follow(to: Route) {
    if (!to.book) showLibrary();
    else openBook({ bookId: to.book, offset: to.offset, chapterId: to.chapter });
  }

  return {
    router,
    books, book, chapter, opening, progress, settings, settingsOpen, palette, fontPicker, names, namesEditorOpen, addName,
    fixNames, commands, unlisted, selectedCommand, mentions, searching, status, found,
    start, follow,
    applySettings, saveSettings, chooseColor, sortBy,
    loadFonts, toggleSettings, setFontTarget, setFontQuery, chooseFont,
    openBook, openNextChapter, trackReadingOffset, showLibrary,
    storeFiles, refreshBook, deleteBook,
    setNames, toggleNamesEditor, saveNames, showAddName, addToNames,
    togglePalette, selectCommand, searchCommands, runCommand,
    rescan, searchLibrary, openFound,
  };
}

export type Store = ReturnType<typeof createStore>;
export const StoreContext = new Context<Store>();
export type { Tracked };
