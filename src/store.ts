// What the page knows, and everything it does: the book open, the chapter, the library, where
// each book was left, the settings, the dialogs, the names. Each is a tracked value the
// components read; the actions below are the only ones that write them. Made once, by App,
// while it is set up (tracked values belong to a component), and handed down as a context.
import { Context, tick, track } from 'ripple';
import type { Tracked } from 'ripple';
import { serverBackend } from './backends.ts';
import type { Bookmark, BookRecord, BookSaying, FileInfo, LibraryStatus, Mention, Person, Progress, Shown } from './backends.ts';
import { fold, PAGE } from './catalog.ts';
import type { Query, Shelved, TagCount } from './catalog.ts';
import { offerFor, paintChapter, paintTitles } from './names.ts';
import type { AddNameAt, AddNameOffer } from './names.ts';
import { markChapter, nameFixer, namesWith } from './marks.ts';
import type { Marked } from './marks.ts';
import { bookRoute, chapterAt, createRouter, getColorScheme, markFound, nextTick, offsetAtTop, toOffset } from './places.ts';
import type { Listed, Route } from './places.ts';
import { latinize } from './parser.ts';

// the most books or chapters the palette lists at once
const LISTED = 200;
// how many books the library's front shows of each kind, and of tags
const FRONT = { reading: 6, latest: 10, random: 6, tags: 40, bookmarks: 8 };
// how many bookmarks a search of the library shows above its books, and the palette lists
const BOOKMARKS_FOUND = { library: 5, palette: 20 };
const newSeed = () => Math.floor(Math.random() * 2 ** 31);

export type Settings = Record<string, any>;
// what the palette offers: a book, a chapter, or a place in the book that says what was typed
export type Command = { key: string; label: string; term: string; open: { bookId: string; offset?: number; chapterId?: string }; mention?: Mention; bookmark?: Bookmark };
// what the list beside the page shows: the book's chapters, or its bookmarks
export type Sidebar = 'chapters' | 'bookmarks';

// whether a bookmark says every word of `q` (folded, as the server folds them): its note, the
// words it begins with, its chapter's title
export function bookmarkSays(bookmark: Bookmark, q: string) {
  let said = fold([bookmark.note, bookmark.quote, bookmark.chapterTitle ?? ''].join('\n'));
  return fold(q).split(/\s+/).every(word => said.includes(word));
}

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
// whether a face is there to be named: text set in it comes out another width than in the generic
// family it would otherwise fall back to. A guess, but the only one a page can make
const probe = document.createElement('canvas').getContext('2d');
export function hasFont(family: string) {
  if (family === 'system-ui' || !probe) return true;
  return ['serif', 'sans-serif', 'monospace'].some(generic => {
    let text = 'mmmmmmmmmlli WwQq 0123456789';
    probe.font = `72px ${generic}`;
    let fallback = probe.measureText(text).width;
    probe.font = `72px ${cssFontFamily(family)}, ${generic}`;
    return probe.measureText(text).width !== fallback;
  });
}
// the fonts are the device's: a phone has none of the ones a desktop has, and is read at another
// size. The faces, sizes and weights, and the list of what is installed, are kept in this browser,
// and the other settings with the backend, for every device alike
const DEVICE_KEY = 'hyper-reader:device';
const deviceKeys = new Set<string>(['fonts', 'sidebar', ...Object.values(fontSettings).flatMap(Object.values)]);
const keptOnDevice = (): Settings | null => {
  try { return JSON.parse(localStorage.getItem(DEVICE_KEY) ?? 'null'); } catch { return null; }
};
// the settings of the one and of the other
function splitSettings(all: Settings) {
  let device: Settings = {}, shared: Settings = {};
  for (let [key, value] of Object.entries(all)) (deviceKeys.has(key) ? device : shared)[key] = value;
  return { device, shared };
}

// a setting css can select on goes on the element. A list or a shape is for the
// app to read and only reads as junk in an attribute, so it stays out of one
function applyDataset(key: string, value: unknown) {
  if (value != null && typeof value === 'object') return;
  document.documentElement.dataset[key] = String(value ?? '');
}

export function createStore() {
  const router = createRouter();
  const backend = serverBackend();

  const book = track<BookRecord | null>(null);
  // the chapter open, its lines corrected by the book's names and the names in them marked, as the
  // backend gave it (see marks.ts)
  const chapter = track<Shown | null>(null);
  // the chapter asked for, while its text is on its way: the list shows it as the one read
  const opening = track<string | null>(null);
  const progress = track<Record<string, Progress>>({});
  const settings = track<Settings>({});
  // the library, which the backend looks through and the page shows a page of: its front (the
  // books being read, the newest, a few at random in the order of `seed`, and the tags most books
  // have), and what it was asked for, with what was found so far of how many
  const shelves = track<{ reading: Shelved[]; latest: Shelved[]; random: Shelved[]; seed: number; tags: TagCount[] } | null>(null);
  const finding = track<{ query: Query; total: number; books: Shelved[]; busy: boolean } | null>(null);
  // the books the palette offers with no book open, asked of the backend as it is typed
  const paletteBooks = track<{ total: number; books: Shelved[] }>({ total: 0, books: [] });
  // `text` as typed, `q` as searched for
  const palette = track({ open: false, text: '', q: '', selectedIndex: 0 });
  // the places in the book open that say what the palette was given, and whether the whole book
  // was indexed when asked
  const mentions = track<{ q: string; indexed: boolean; total: number; found: Mention[] }>({ q: '', indexed: true, total: 0, found: [] });
  // the libraries on the server's disk: the books, the scan going or last, the index
  const status = track<LibraryStatus | null>(null);
  // the library searched: the characters, and the books that say it
  const found = track<{ q: string; characters: Person[]; books: BookSaying[] }>({ q: '', characters: [], books: [] });
  // the settings panel, and in it the fonts: which of the two the list picks, and its filter
  const settingsOpen = track(false);
  const fontPicker = track<{ q: string; target: FontTarget }>({ q: '', target: 'reading' });
  const names = track('');
  const namesEditorOpen = track(false);
  // the chapter list, where the window is too narrow to keep it beside the page (see styles.css)
  const chaptersOpen = track(false);
  const addName = track<AddNameOffer | null>(null);
  // the bookmarks of the book open, in the order of its text; the paragraph at the top of the page
  // (the one `B` bookmarks); and the bookmark whose note is being written
  const bookmarks = track<Bookmark[]>([]);
  const readingAt = track<number | null>(null);
  const noting = track<number | null>(null);
  // the bookmark the reader is at: the last at or before the paragraph at the top of the page
  const bookmarkAt = track(() => {
    let at = readingAt.value;
    return at == null ? undefined : bookmarks.value.findLast(b => b.offset <= at);
  });
  // the one of the paragraph at the top of the page, if it has one
  const bookmarkHere = track(() => {
    let at = readingAt.value;
    return at == null ? undefined : bookmarks.value.find(b => b.offset === paragraphAt(at));
  });
  // of every book: the newest, on the library's front; those that say what the library is asked
  // for; all of them, searched, where the library shows them all (null: it does not); and those
  // the palette offers with no book open
  const recentBookmarks = track<Bookmark[]>([]);
  const foundBookmarks = track<{ q: string; total: number; bookmarks: Bookmark[] }>({ q: '', total: 0, bookmarks: [] });
  const allBookmarks = track<{ q: string; total: number; bookmarks: Bookmark[]; busy: boolean } | null>(null);
  const paletteBookmarks = track<{ q: string; bookmarks: Bookmark[] }>({ q: '', bookmarks: [] });
  // the names as the list corrects them, made again only when the list changes
  const fixNames = track(() => nameFixer(names.value));
  // while the list is edited, the chapter as what is typed would have it, marked here; and the
  // chapter as the page shows it, so
  const edited = track<Marked | null>(null);
  const shown = track(() => (chapter.value && edited.value ? { ...chapter.value, ...edited.value } : chapter.value));

  // what the command palette offers: the books the backend found, or the chapters of the one
  // open, searchable under both spellings of a corrected title
  const bookCommands = track(() => paletteBooks.value.books.map(({ id, title, read }) => (
    { key: `book:${id}`, label: title, open: { bookId: id, offset: read?.offset, chapterId: read?.chapterId }, term: '' }
  )));
  // the bookmarks that say what was typed: the book's, or with none open, every book's
  const bookmarkCommands = track<Command[]>(() => {
    let q = palette.value.q;
    if (!q) return [];
    let open = book.value;
    let found = open ? bookmarks.value.filter(b => bookmarkSays(b, q)) : paletteBookmarks.value.q === q ? paletteBookmarks.value.bookmarks : [];
    return found.map(b => ({ key: `bookmark:${b.id}`, label: b.note || b.quote, term: '', open: { bookId: b.bookId, offset: b.offset }, bookmark: b }));
  });
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
  // the chapters named so, of which the palette lists the first LISTED (a book of thousands is
  // narrowed by typing), or the books found so; and the places in the book that say it
  const named = track(() => (book.value ? chapterCommands.value.filter(c => c.term.includes(palette.value.q)) : bookCommands.value));
  const commands = track<Command[]>(() => [...bookmarkCommands.value, ...named.value.slice(0, LISTED), ...mentionCommands.value]);
  const unlisted = track(() => (book.value ? Math.max(0, named.value.length - LISTED) : paletteBooks.value.total - paletteBooks.value.books.length));
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
    let { device, shared } = splitSettings(changed);
    if (Object.keys(device).length > 0) localStorage.setItem(DEVICE_KEY, JSON.stringify({ ...keptOnDevice(), ...device }));
    if (Object.keys(shared).length > 0) await backend.saveSettings(shared);
  }
  async function chooseColor(color: string) {
    await saveSettings({ [`color:${getColorScheme()}`]: color });
    highlight();
  }

  // ---- fonts
  // the fonts installed, which only chromium says, and only when the reader lets it: the list
  // is kept once it is given, and asked for again only when asked to be
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
  // its front, asked of the backend
  async function loadShelves() {
    let seed = newSeed();
    let [reading, latest, random, tags] = await Promise.all([
      backend.books({ sort: 'read', limit: FRONT.reading }),
      backend.books({ sort: 'latest', limit: FRONT.latest }),
      backend.books({ sort: 'random', seed, limit: FRONT.random }),
      backend.tags(FRONT.tags),
    ]);
    shelves.value = { reading: reading.books, latest: latest.books, random: random.books, seed, tags };
    recentBookmarks.value = (await backend.findBookmarks('', 0, FRONT.bookmarks)).bookmarks;
  }
  // other books at random
  async function shuffle() {
    let seed = newSeed();
    let { books: random } = await backend.books({ sort: 'random', seed, limit: FRONT.random });
    if (shelves.value) shelves.value = { ...shelves.value, random, seed };
  }
  // the library asked for `query`: the first page of the books it has so, `wait` ms after it
  // was last asked (as it is typed). Null is its front again
  let findTimer: ReturnType<typeof setTimeout> | undefined;
  let asking = 0;
  function find(query: Query | null, wait = 0) {
    clearTimeout(findTimer);
    let ask = ++asking;
    if (!query) {
      foundBookmarks.value = { q: '', total: 0, bookmarks: [] };
      return void (finding.value = null);
    }
    // what was found stays in sight until what is asked now comes
    finding.value = { query, total: finding.value?.total ?? 0, books: finding.value?.books ?? [], busy: true };
    findTimer = setTimeout(async () => {
      // and the bookmarks that say the words asked for
      let q = query.q?.trim() ?? '';
      let [{ total, books }, marked] = await Promise.all([
        backend.books({ ...query, offset: 0, limit: PAGE }),
        q ? backend.findBookmarks(q, 0, BOOKMARKS_FOUND.library) : null,
      ]);
      if (ask !== asking) return;
      finding.value = { query, total, books, busy: false };
      foundBookmarks.value = marked ? { q, total: marked.total, bookmarks: marked.bookmarks } : { q: '', total: 0, bookmarks: [] };
    }, wait);
  }
  // the next page of what was asked
  async function findMore() {
    let now = finding.value;
    if (!now || now.busy || now.books.length >= now.total) return;
    let ask = asking;
    finding.value = { ...now, busy: true };
    let { total, books } = await backend.books({ ...now.query, offset: now.books.length, limit: PAGE });
    if (ask === asking) finding.value = { ...now, total, books: [...now.books, ...books], busy: false };
  }
  // the library's lists asked again: a book came, went, or was read
  function refreshLibrary() {
    loadShelves();
    if (finding.value) find(finding.value.query);
    if (allBookmarks.value) findAllBookmarks(allBookmarks.value.q);
  }

  // ---- bookmarks
  // the paragraph a bookmark at `offset` would be of, as the server puts it: the first line with
  // words in it, from the one `offset` is in
  function paragraphAt(offset: number) {
    let lines = chapter.value?.lines ?? [];
    let at = Math.max(0, lines.findLastIndex(line => line.offset <= offset));
    return (lines.slice(at).find(line => line.text.trim()) ?? lines[at])?.offset ?? offset;
  }
  async function loadBookmarks(bookId: string) {
    let loaded = await backend.bookmarks(bookId);
    if (book.value?.id === bookId) bookmarks.value = loaded;
  }
  // the paragraph at the top of the page bookmarked, and its note asked for; or, bookmarked
  // already, no longer
  async function toggleBookmark() {
    let open = book.value;
    let at = offsetAtTop() ?? readingAt.value ?? chapter.value?.offset;
    if (!open || at == null) return;
    readingAt.value = at;
    let had = bookmarkHere.value;
    if (had) return deleteBookmark(had);
    let made = await backend.addBookmark(open.id, at);
    if (!made || book.value?.id !== open.id) return;
    bookmarks.value = [...bookmarks.value.filter(b => b.id !== made.id), made].sort((a, z) => a.offset - z.offset);
    editNote(made.id);
  }
  // the note of a bookmark of the book open written (null: put away)
  async function editNote(id: number | null) {
    noting.value = id;
    if (id == null) return;
    await nextTick();
    document.querySelector<HTMLInputElement>('#bookmark-note input')?.focus();
  }
  // a bookmark changed, wherever it is shown
  function replaceBookmark(id: number, changed: Bookmark | null) {
    let swap = (list: Bookmark[]) => list.flatMap(b => (b.id !== id ? [b] : changed ? [{ ...changed, missing: b.missing }] : []));
    bookmarks.value = swap(bookmarks.value);
    recentBookmarks.value = swap(recentBookmarks.value);
    let found = foundBookmarks.value;
    foundBookmarks.value = { ...found, bookmarks: swap(found.bookmarks), total: found.total - (changed || !found.bookmarks.some(b => b.id === id) ? 0 : 1) };
    let all = allBookmarks.value;
    if (all) allBookmarks.value = { ...all, bookmarks: swap(all.bookmarks), total: all.total - (changed || !all.bookmarks.some(b => b.id === id) ? 0 : 1) };
    paletteBookmarks.value = { ...paletteBookmarks.value, bookmarks: swap(paletteBookmarks.value.bookmarks) };
  }
  async function saveNote(bookmark: Bookmark, note: string) {
    noting.value = null;
    if (note.trim() === bookmark.note) return;
    replaceBookmark(bookmark.id, await backend.saveBookmarkNote(bookmark.id, note));
  }
  async function deleteBookmark(bookmark: Bookmark) {
    if (noting.value === bookmark.id) noting.value = null;
    await backend.deleteBookmark(bookmark.id);
    replaceBookmark(bookmark.id, null);
  }
  // the list beside the page: the chapters, or the bookmarks (kept on this device)
  const showSidebar = (which: Sidebar) => saveSettings({ sidebar: which });
  // every book's bookmarks, as the library shows them all: those that say `q`, `wait` ms after it
  // was last asked (as it is typed). Null: the library's front again
  let bookmarksTimer: ReturnType<typeof setTimeout> | undefined;
  let askingBookmarks = 0;
  function findAllBookmarks(q: string | null, wait = 0) {
    clearTimeout(bookmarksTimer);
    let ask = ++askingBookmarks;
    if (q == null) return void (allBookmarks.value = null);
    allBookmarks.value = { q, total: allBookmarks.value?.total ?? 0, bookmarks: allBookmarks.value?.bookmarks ?? [], busy: true };
    bookmarksTimer = setTimeout(async () => {
      let { total, bookmarks: found } = await backend.findBookmarks(q.trim(), 0, PAGE);
      if (ask === askingBookmarks) allBookmarks.value = { q, total, bookmarks: found, busy: false };
    }, wait);
  }
  async function findMoreBookmarks() {
    let now = allBookmarks.value;
    if (!now || now.busy || now.bookmarks.length >= now.total) return;
    let ask = askingBookmarks;
    allBookmarks.value = { ...now, busy: true };
    let { total, bookmarks: more } = await backend.findBookmarks(now.q.trim(), now.bookmarks.length, PAGE);
    if (ask === askingBookmarks) allBookmarks.value = { ...now, total, bookmarks: [...now.bookmarks, ...more], busy: false };
  }
  async function loadProgress() {
    progress.value = await backend.progress();
  }

  // ---- reading
  // a book's progress is saved a while after the reader stops: 10s after a chapter opens, 3s
  // after a scroll
  let progressTimer: ReturnType<typeof setTimeout> | undefined;
  let unsaved: (() => Promise<void>) | null = null;
  function saveProgressLater(open: BookRecord, at: Listed, offset: number, wait: number) {
    clearTimeout(progressTimer);
    unsaved = () => saveProgress(open, at, offset);
    progressTimer = setTimeout(() => saveNow(), wait);
  }
  // the progress waiting to be saved, saved at once: the book is left
  function saveNow() {
    clearTimeout(progressTimer);
    let save = unsaved;
    unsaved = null;
    return save?.() ?? Promise.resolve();
  }
  async function saveProgress(open: BookRecord, at: Listed, offset?: number) {
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
    if (!sameBook) bookmarks.value = [];
    book.value = record;
    chapter.value = found;
    readingAt.value = position;
    edited.value = null;
    opening.value = null;
    chaptersOpen.value = false;
    paintShown();
    togglePalette(false);
    loadNames(record.id);
    // (a book read again may have put its bookmarks elsewhere)
    if (!sameBook || fresh) loadBookmarks(record.id);
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
    if (!(offset >= at.offset && offset <= at.offset + at.length)) return;
    readingAt.value = offset;
    if (toOffset(router.current().offset) === offset) return;
    router.replace(bookRoute({ bookId: open.id, offset }));
    saveProgressLater(open, at, offset, 3000);
  }
  async function showLibrary() {
    if (!book.value) return;
    // a chapter on its way is not opened after all
    asked++;
    opening.value = null;
    chaptersOpen.value = false;
    noting.value = null;
    book.value = null;
    chapter.value = null;
    bookmarks.value = [];
    readingAt.value = null;
    router.push({});
    document.title = 'Text Reader';
    togglePalette(false);
    // where the book was left is the first of the books being read
    saveNow().then(refreshLibrary);
    await tick();
    requestAnimationFrame(() => scroll(0, 0));
  }

  // ---- books in and out
  // `files` are what was dropped; a book is a .txt file, and the name decides, since some
  // systems hand one over without a type
  async function storeFiles(dropped: File[]) {
    let readFile = (file: File) => new Promise<FileInfo & { text: string }>(resolve => {
      let fileReader = new FileReader();
      fileReader.addEventListener('load', () => resolve({ name: file.name, size: file.size, date: file.lastModified, text: fileReader.result as string }));
      fileReader.readAsText(file);
    });
    let read = [];
    for (let file of dropped) read.push(await readFile(file));
    let added = await backend.addBooks(read);
    refreshLibrary();
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
    refreshLibrary();
  }

  // ---- names
  // the chapter's names put in colour where they were found
  const paintShown = () => shown.value && paintChapter(shown.value);
  // and those of the list in the titles of the chapter list, which stay as they are from one
  // chapter to the next: painted again for another book or list, or `again`
  let navPainted: { record: BookRecord | null; names: string } | null = null;
  function paintNav(again = false) {
    let record = book.value;
    if (!again && navPainted?.record === record && navPainted.names === names.value) return;
    navPainted = { record, names: names.value };
    paintTitles('nl', 'nav a .name', names.value);
  }
  function highlight() {
    paintShown();
    paintNav(true);
  }
  const highlightPalette = () => paintTitles('cp', '#command-palette a', names.value, shown.value);
  async function loadNames(bookId: string) {
    let loaded = (await backend.names(bookId)) ?? '';
    if (book.value?.id !== bookId) return;
    names.value = loaded;
    paintNav();
  }
  // the list as it is typed: the chapter is marked here, from its text as stored (asked of the
  // backend the first time), a moment after the typing stops
  let stored: { key: string; content: string; offset: number } | null = null;
  let markTimer: ReturnType<typeof setTimeout> | undefined;
  function setNames(text: string) {
    names.value = text;
    clearTimeout(markTimer);
    markTimer = setTimeout(async () => {
      let open = book.value;
      let at = chapter.value;
      if (!open || !at) return;
      let key = `${open.id}/${at.id}`;
      if (stored?.key !== key) {
        let found = await backend.chapter(open.id, at, true);
        if (found?.content == null || chapter.value !== at) return;
        stored = { key, content: found.content, offset: found.offset };
      }
      edited.value = markChapter(stored, names.value);
      highlight();
    }, 300);
  }
  const toggleNamesEditor = (open: boolean) => { namesEditorOpen.value = open; };
  const toggleChapters = (open = !chaptersOpen.value) => { chaptersOpen.value = open; };
  // the chapter as the backend marks it with the list saved
  async function markAgain(open: BookRecord) {
    clearTimeout(markTimer);
    let at = chapter.value;
    let found = at && await backend.chapter(open.id, at);
    if (found && chapter.value === at) {
      chapter.value = found;
      edited.value = null;
    }
    highlight();
  }
  async function saveNames() {
    let open = book.value;
    namesEditorOpen.value = false;
    if (!open) return;
    await backend.saveNames(open.id, `${names.value.trim()}\n`);
    await markAgain(open);
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
    await markAgain(open);
    highlightPalette();
  }

  // ---- the command palette
  async function togglePalette(open?: boolean, text?: string) {
    let opened = open ?? !palette.value.open;
    if (opened === palette.value.open && text === undefined) return;
    palette.value = { ...palette.value, open: opened };
    if (!opened) return;
    if (text !== undefined || !book.value) searchCommands(text ?? palette.value.text);
    await nextTick();
    document.querySelector<HTMLInputElement>('#command-palette input')?.select();
    highlightMatches();
    highlightPalette();
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
  let paletteTimer: ReturnType<typeof setTimeout> | undefined;
  async function searchCommands(text: string) {
    let q = text.trim().toLowerCase();
    palette.value = { ...palette.value, text, q, selectedIndex: 0 };
    clearTimeout(mentionsTimer);
    clearTimeout(paletteTimer);
    let open = book.value;
    // with no book open, the books named so, asked of the backend (the books being read when
    // nothing is typed, or the newest when none is)
    if (!open) {
      paletteTimer = setTimeout(async () => {
        let found = await backend.books(q ? { q, limit: 50 } : { sort: 'read', limit: 50 });
        if (!q && !found.total) found = await backend.books({ sort: 'latest', limit: 50 });
        if (palette.value.q !== q || book.value) return;
        paletteBooks.value = found;
        paletteBookmarks.value = { q, bookmarks: q ? (await backend.findBookmarks(q, 0, BOOKMARKS_FOUND.palette)).bookmarks : [] };
        if (palette.value.q !== q || book.value) return;
        selectCommand(0);
        highlightMatches();
      }, q ? 150 : 0);
    }
    if (open && q.length >= 2) {
      mentionsTimer = setTimeout(async () => {
        let { indexed, total, mentions: places } = await backend.searchBook(text.trim(), open.id);
        if (palette.value.q !== q || book.value?.id !== open.id) return;
        mentions.value = { q, indexed, total, found: places.slice(0, 200) };
        highlightMatches();
        highlightPalette();
      }, 250);
    } else {
      mentions.value = { q, indexed: true, total: 0, found: [] };
    }
    selectCommand(0);
    highlightMatches();
    highlightPalette();
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
      // the first of its own text that says it (not that of a label in it, a <small>)
      let text = [...link.childNodes].find(node => node.nodeType === Node.TEXT_NODE && latinize(node.textContent || '').toLowerCase().includes(q));
      if (!text) continue;
      let match = latinize(text.textContent || '').toLowerCase();
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
    let was = status.value;
    let now = await backend.status();
    status.value = now;
    if (was?.scan.running && !now.scan.running) refreshLibrary();
    if (now.scan.running || now.index.done < now.index.total) statusTimer = setTimeout(watchStatus, 1500);
  }
  async function rescan() {
    status.value = await backend.scan();
    watchStatus();
  }
  // the library searched for `text`: the characters named so, and the books that say it
  let foundTimer: ReturnType<typeof setTimeout> | undefined;
  function searchLibrary(text: string) {
    clearTimeout(foundTimer);
    let q = text.trim();
    if (!q) {
      found.value = { q: '', characters: [], books: [] };
      return;
    }
    found.value = { ...found.value, q };
    foundTimer = setTimeout(async () => {
      let [characters, books] = await Promise.all([backend.characters(q), backend.search(q)]);
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
    let { device, shared } = splitSettings(await backend.settings());
    applySettings(shared);
    // the fonts the backend kept for every device, before they were each device's, are where a
    // device starts from, for whatever it has not chosen itself. A face it does not have falls
    // back to Reader in the stylesheet, so it is kept rather than guessed away. The list of what
    // is installed is another device's, and not
    let { fonts, ...before } = device;
    applySettings({ ...before, ...keptOnDevice() });
    loadProgress();
    loadShelves();
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
    book, chapter, shown, opening, progress, settings, settingsOpen, palette, fontPicker, names, namesEditorOpen, chaptersOpen, addName,
    shelves, finding, shuffle, find, findMore,
    bookmarks, noting, bookmarkAt, bookmarkHere, recentBookmarks, foundBookmarks, allBookmarks,
    toggleBookmark, editNote, saveNote, deleteBookmark, showSidebar, findAllBookmarks, findMoreBookmarks,
    fixNames, commands, unlisted, selectedCommand, mentions, status, found,
    start, follow,
    applySettings, saveSettings, chooseColor,
    loadFonts, toggleSettings, setFontTarget, setFontQuery, chooseFont,
    openBook, openNextChapter, trackReadingOffset, showLibrary,
    storeFiles, refreshBook, deleteBook,
    setNames, toggleNamesEditor, toggleChapters, saveNames, showAddName, addToNames,
    togglePalette, selectCommand, searchCommands, runCommand,
    rescan, searchLibrary, openFound,
  };
}

export type Store = ReturnType<typeof createStore>;
export const StoreContext = new Context<Store>();
export type { Tracked };
