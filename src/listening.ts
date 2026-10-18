// What the page listens for, the whole time it is open: the url, books dropped on it, the keys,
// the reader scrolling, and the pointer over a name. Started once by App; what it returns stops
// it all.
import { addNameAt, asName, detectedNameAt, wholeWords } from './names.ts';
import { offsetAtTop, onKey } from './places.ts';
import type { Store } from './store.ts';

export function listen(store: Store) {
  let stops: (() => void)[] = [];
  let on = (target: EventTarget, type: string, handler: (event: any) => void, options?: AddEventListenerOptions) => {
    target.addEventListener(type, handler, options);
    stops.push(() => target.removeEventListener(type, handler, options));
  };

  // the reader stepped back or on
  stops.push(store.router.listen(to => store.follow(to)));

  // a book is a .txt file; some systems hand one over without a type, so the name decides
  on(window, 'dragenter', (event: DragEvent) => event.preventDefault());
  on(window, 'dragover', (event: DragEvent) => event.preventDefault());
  on(window, 'drop', (event: DragEvent) => {
    event.preventDefault();
    let dropped = [...(event.dataTransfer?.files ?? [])];
    let books = dropped.filter(file => /\.txt$/i.test(file.name));
    let ignored = dropped.filter(file => !books.includes(file));
    if (ignored.length) console.info('Not a .txt book, left out:', ignored.map(file => file.name));
    if (books.length) store.storeFiles(books);
  });

  // the next and the previous chapter, and back to the library, unless the keys are typing
  on(window, 'keydown', (event: KeyboardEvent) => {
    let target = event.target as HTMLElement;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(target.tagName)) return;
    if (event.key === 'ArrowRight') store.openNextChapter(+1);
    else if (event.key === 'ArrowLeft') store.openNextChapter(-1);
    else if (event.key === 'Backspace') store.showLibrary();
  });
  stops.push(onKey('Cmd+K', () => store.togglePalette()));
  stops.push(onKey('Escape', () => store.togglePalette(false)));
  // a non-modal dialog is not dismissed for us: the settings go with Escape, or a click anywhere
  // but on them (or on the cog, which puts them away itself)
  stops.push(onKey('Escape', () => store.toggleSettings(false)));
  // and so does the chapter list, where it is laid over the page
  stops.push(onKey('Escape', () => store.toggleChapters(false)));
  on(document, 'pointerdown', (event: PointerEvent) => {
    if (!store.chaptersOpen.value || (event.target as Element).closest?.('nav, aside button.chapters')) return;
    store.toggleChapters(false);
  });
  on(document, 'pointerdown', (event: PointerEvent) => {
    if (!store.settingsOpen.value || (event.target as Element).closest?.('#settings, aside button.cog')) return;
    store.toggleSettings(false);
  });
  // the arrows move through the palette's list, while it has the keys
  on(window, 'keydown', (event: KeyboardEvent) => {
    if (!(event.target as HTMLElement).closest?.('#command-palette')) return;
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
    event.preventDefault();
    store.selectCommand(store.palette.value.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
  });

  // the url follows the reader down the page. history.replaceState is rate limited, and a
  // scroll fires far more often than that. No capture: scrolling the chapter list is not reading
  let scrolled: ReturnType<typeof setTimeout> | undefined;
  on(window, 'scroll', () => {
    clearTimeout(scrolled);
    scrolled = setTimeout(() => {
      let offset = offsetAtTop();
      if (offset != null) store.trackReadingOffset(offset);
    }, 200);
  }, { passive: true });
  stops.push(() => clearTimeout(scrolled));

  // the button that adds a name: over a name still missing from the list, or a selection
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  // the last pointer position, so a selection that wraps over two lines can be
  // anchored to the line being dragged over, not to the first one
  let pointer: { x?: number; y?: number } = {};
  let show = (at: ReturnType<typeof addNameAt> | false | undefined) => {
    clearTimeout(hideTimer);
    if (at) store.showAddName(at);
    // a small grace period, the pointer has to travel to the button
    else hideTimer = setTimeout(() => store.showAddName(null), 300);
  };
  let selectedName = () => {
    let selection = getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    let range = wholeWords(selection.getRangeAt(0));
    let el = range.commonAncestorContainer as Element;
    if (el.nodeType === Node.TEXT_NODE) el = el.parentElement!;
    if (!el?.closest('article, nav, #command-palette')) return;
    let name = asName(range);
    if (name) return addNameAt(range, name, pointer.x, pointer.y);
  };
  let busy = () => document.querySelector('#names-editor[open], #settings[open]');
  let hoveredName = (x: number, y: number) => {
    // a selection is the more explicit ask, let it win
    if (!getSelection()?.isCollapsed) return;
    let found = detectedNameAt(x, y);
    if (found) return addNameAt(found.range, found.name, x, y);
  };
  on(window, 'mousemove', (event: MouseEvent) => {
    // moving onto the button itself must not take it away
    if ((event.target as Element).closest?.('#add-name')) return clearTimeout(hideTimer);
    pointer = { x: event.clientX, y: event.clientY };
    show(!busy() && (selectedName() || hoveredName(event.clientX, event.clientY)));
  });
  let onSelectionChange = () => show(!busy() && selectedName());
  // the button is fixed, so a scroll slides the name out from under it
  on(window, 'scroll', onSelectionChange, { capture: true, passive: true });
  on(document, 'selectionchange', onSelectionChange);
  stops.push(() => clearTimeout(hideTimer));

  store.start();
  return () => stops.forEach(stop => stop());
}
