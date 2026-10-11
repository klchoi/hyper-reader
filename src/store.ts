// What the page knows, and everything it does: the book open, the chapter, the library, where
// each book was left, the settings, the dialogs, the names. Each is a tracked value the
// components read; the actions below are the only ones that write them. Made once, by App,
// while it is set up (tracked values belong to a component), and handed down as a context.
import { Context, tick, track } from 'ripple';
import type { Tracked } from 'ripple';
import { chooseBackend } from './backends.ts';
import type { Backend, BookRecord, FileInfo, Progress } from './backends.ts';
import { articleNames, commandPaletteNames, highlightNames, nameFixer, namesWith, offerFor } from './names.ts';
import type { AddNameAt, AddNameOffer } from './names.ts';
import { HashRouter, bookRoute, chapterAt, getColorScheme, nextTick, toOffset } from './places.ts';
import type { Chapter, Listed } from './places.ts';

// what the page is given to start with: the parser and what a book is (see load-parser.js),
// and the reader of books (see reading.js)
export type Page = {
  parser: {
    Book(file: { name: string }): { id: string; name: string; description?: string };
    bookRecord(book: any): BookRecord;
    latinize(text: string): string;
    PARSER_VERSION: number;
  };
  reader: { readBook(file: FileInfo, text: string): Promise<any> };
};

export type Settings = Record<string, any>;
export type Command = { key: string; label: string; term: string; open: { bookId: string; offset?: number; chapterId?: string } };

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

export function createStore({ parser, reader }: Page) {
  const router = new HashRouter();
  let backend: Backend;

  const files = track<FileInfo[]>([]);
  const book = track<BookRecord | null>(null);
  const chapter = track<Chapter | null>(null);
  const progress = track<Record<string, Progress>>({});
  const settings = track<Settings>({ sort: { field: 'updatedAt', direction: 'desc' } });
  const palette = track({ open: false, q: '', selectedIndex: 0 });
  const fontPicker = track<{ open: boolean; q: string; target: FontTarget }>({ open: false, q: '', target: 'reading' });
  const names = track('');
  const namesEditorOpen = track(false);
  const addName = track<AddNameOffer | null>(null);
  // the names as the list corrects them, made again only when the list changes
  const fixNames = track(() => nameFixer(names.value));

  // what the command palette offers: the books, or the chapters of the one open, searchable
  // under both spellings of a corrected title
  const bookCommands = track(() => files.value.map(file => {
    let { id, name } = parser.Book(file);
    let { offset, chapterId } = progress.value[id] || {};
    return { key: `book:${id}`, label: name, open: { bookId: id, offset, chapterId }, term: parser.latinize(name).toLowerCase() };
  }));
  const chapterCommands = track(() => {
    let open = book.value;
    if (!open) return [];
    let fix = fixNames.value;
    return open.chapters.map(listed => {
      let label = fix(listed.title);
      return { key: `chapter:${listed.offset}`, label, open: { bookId: open.id, offset: listed.offset }, term: parser.latinize(`${label} | ${listed.title}`).toLowerCase() };
    });
  });
  const commands = track<Command[]>(() => (book.value ? chapterCommands.value : bookCommands.value).filter(c => c.term.includes(palette.value.q)));
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
  async function toggleFontPicker(open: boolean) {
    fontPicker.value = { ...fontPicker.value, open, q: '' };
    if (!open) return;
    // queryLocalFonts only answers while the click that opened this still counts
    // as the reader asking, so the list is asked for before waiting on anything
    loadFonts();
    await nextTick();
    document.querySelector<HTMLInputElement>('#font-picker input')?.select();
  }
  const setFontTarget = (target: FontTarget) => { fontPicker.value = { ...fontPicker.value, target }; };
  const setFontQuery = (q: string) => { fontPicker.value = { ...fontPicker.value, q }; };
  const chooseFont = (font: string) => saveSettings({ [fontSettings[fontPicker.value.target].family]: font });

  // ---- the library
  async function loadFiles() {
    let kept = await backend.files();
    kept.sort((a, z) => a.name.localeCompare(z.name, 'vi-VN', { sensitivity: 'accent' }));
    files.value = kept;
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
  async function openBook({ bookId, offset, chapterId }: { bookId: string; offset?: unknown; chapterId?: string | null }) {
    if (!bookId) {
      console.info('Failed to load file:', { bookId, offset, chapterId });
      return;
    }
    // nothing to go on means the book starts over
    let listedIn = (record: BookRecord): Listed => chapterAt(record.chapters, offset)
      || record.chapters.find(c => c.id === chapterId)
      || record.chapters[0];

    // the backend reads the book again when an older parser read it
    let record = await backend.book(bookId);
    if (!record) {
      console.info('Book not found:', { bookId });
      return;
    }
    let listed = listedIn(record);
    let found = await backend.chapter(bookId, listed);
    // a record that lists a chapter whose text is gone is read again, once
    if (!found) {
      console.info('Chapter not found:', { bookId, offset, chapterId, id: listed.id });
      record = await backend.rereadBook(bookId);
      if (!record) return;
      listed = listedIn(record);
      found = await backend.chapter(bookId, listed);
      if (!found) return;
    }
    // an offset inside the chapter is a place on its page, not just the chapter
    let position = Math.max(toOffset(offset) ?? 0, listed.offset ?? 0);

    let sameBook = book.value?.id === record.id;
    book.value = record;
    chapter.value = found;
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
    if (!open || !chapter.value) return;
    let at = open.chapters.findIndex(c => c.id === chapter.value!.id);
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
    if (toOffset(router.get('offset')) === offset) return;
    router.replace(bookRoute({ bookId: open.id, offset }));
    saveProgressLater(open, at, offset, 3000);
  }
  async function showLibrary() {
    if (!book.value) return;
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
    await backend.addBooks(read);
    loadFiles();

    let books = read.map(file => parser.Book(file));
    let inNewTabs = books;
    let here: (typeof books)[number] | undefined;
    if (book.value) {
      // the book already open opens again here, the others in tabs of their own
      here = books.find(b => b.id === book.value!.id);
      inNewTabs = books.filter(b => b !== here);
    } else {
      // with no book open, the first opens here
      [here, ...inNewTabs] = books;
    }
    // every place is resolved up front: an await between two window.open calls loses the
    // drop's user activation, so every tab after the first gets blocked by the popup blocker
    let kept = await backend.progress();
    let places = new Map(books.map(b => {
      let { offset, chapterId } = kept[b.id] || {};
      return [b.id, { bookId: b.id, offset, chapterId }];
    }));
    let blocked = inNewTabs.filter(b => !window.open(router.route(bookRoute(places.get(b.id)!)), '_blank'));
    if (blocked.length) console.info('Blocked by the popup blocker, opened in the library only:', blocked.map(b => b.name));
    if (here) {
      router.push(bookRoute(places.get(here.id)!));
      await openBook(places.get(here.id)!);
    }
  }
  // the book read again, and opened where the reader is
  async function refreshBook() {
    let open = book.value;
    let at = chapter.value;
    if (!open || !at) return;
    if (!await backend.rereadBook(open.id)) return;
    await openBook({ bookId: open.id, offset: at.offset, chapterId: at.id });
  }
  async function deleteBook(bookId: string) {
    await backend.deleteBook(bookId);
    files.value = files.value.filter(file => parser.Book(file).id !== bookId);
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
  async function togglePalette(open?: boolean) {
    let opened = open ?? !palette.value.open;
    if (opened === palette.value.open) return;
    palette.value = { ...palette.value, open: opened };
    if (!opened) return;
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
  async function searchCommands(q: string) {
    palette.value = { ...palette.value, q: q.trim().toLowerCase(), selectedIndex: 0 };
    selectCommand(0);
    highlightMatches();
    highlightNames(names.value, commandPaletteNames);
  }
  async function runCommand(command: Command | undefined) {
    if (!command) return;
    togglePalette(false);
    await openBook(command.open);
  }
  // what was searched for, marked in each command it was found in
  async function highlightMatches() {
    await nextTick();
    let q = palette.value.q;
    let ranges = [];
    for (let link of document.querySelectorAll('#command-palette a')) {
      let text = link.firstChild;
      if (!text) continue;
      let match = parser.latinize(text.textContent || '').toLowerCase();
      if (!match.includes(q)) continue;
      let start = match.indexOf(q);
      let range = new Range();
      range.setStart(text, start);
      range.setEnd(text, start + q.length);
      ranges.push(range);
    }
    CSS.highlights.set('match', new Highlight(...ranges));
  }

  // ---- starting
  // the settings, the library and where each book was left are asked of the backend; a link
  // into a book opens it
  async function start() {
    applySettings({ 'color:dark': 'night', 'color:light': 'white' });
    backend = await chooseBackend({ readBook: reader.readBook, bookRecord: parser.bookRecord, PARSER_VERSION: parser.PARSER_VERSION });
    applySettings(await backend.settings());
    loadProgress();
    loadFiles();
    let bookId = router.get('book');
    if (bookId) openBook({ bookId, offset: router.get('offset'), chapterId: router.get('chapter') });
  }
  // the url changed under the page: back to the library, or into a book
  function followUrl(hash: string) {
    let to = router.parse(hash);
    if (!to.book) showLibrary();
    else openBook({ bookId: to.book, offset: to.offset, chapterId: to.chapter });
  }

  return {
    router, parser,
    files, book, chapter, progress, settings, palette, fontPicker, names, namesEditorOpen, addName,
    fixNames, commands, selectedCommand,
    start, followUrl,
    applySettings, saveSettings, chooseColor, sortBy,
    loadFonts, toggleFontPicker, setFontTarget, setFontQuery, chooseFont,
    openBook, openNextChapter, trackReadingOffset, showLibrary,
    storeFiles, refreshBook, deleteBook,
    setNames, toggleNamesEditor, saveNames, showAddName, addToNames,
    togglePalette, selectCommand, searchCommands, runCommand,
  };
}

export type Store = ReturnType<typeof createStore>;
export const StoreContext = new Context<Store>();
export type { Tracked };
