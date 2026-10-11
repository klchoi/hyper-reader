// The page: the chapter list, the library or the chapter open, the settings, and the dialogs.
// The store holds everything they show (see store.ts); App makes it, and starts listening.
import { effect, untrack } from 'ripple';
import { createStore, cssFontFamily, StoreContext } from './store.ts';
import type { Page } from './store.ts';
import { listen } from './listening.ts';
import { ChapterList } from './ChapterList.tsrx';
import { Library } from './Library.tsrx';
import { ChapterText } from './ChapterText.tsrx';
import { Settings } from './Settings.tsrx';
import { CommandPalette } from './CommandPalette.tsrx';
import { FontPicker } from './FontPicker.tsrx';
import { NamesEditor } from './NamesEditor.tsrx';
import { AddName } from './AddName.tsrx';

export function App(page: Page) @{
  const store = createStore(page);
  StoreContext.set(store);

  // the faces and sizes chosen, as the variables the stylesheet reads. Sizes and weights are
  // read back as numbers, so a setting can only ever land in the stylesheet as one
  effect(() => {
    let settings = store.settings.value;
    let root = document.documentElement.style;
    let typography: Record<string, string | false | undefined> = {
      '--reading-font': settings.font && `${cssFontFamily(settings.font)}, Reader`,
      '--reading-font-size': settings.fontSize && `${Number(settings.fontSize)}pt`,
      '--reading-font-weight': settings.fontWeight && `${Number(settings.fontWeight)}`,
      '--ui-font': settings.uiFont && `${cssFontFamily(settings.uiFont)}, Reader`,
      '--ui-font-size': settings.uiFontSize && `${Number(settings.uiFontSize)}pt`,
      '--ui-font-weight': settings.uiFontWeight && `${Number(settings.uiFontWeight)}`,
    };
    for (let [name, value] of Object.entries(typography)) {
      if (value) root.setProperty(name, value);
      else root.removeProperty(name);
    }
  });
  // once, whatever it reads
  effect(() => untrack(() => listen(store)));

  <>
    <ChapterList />
    @if (!store.book.value) {
      <Library />
    }
    @if (store.chapter.value) {
      <ChapterText />
    }
    <Settings />
    <CommandPalette />
    <FontPicker />
    <NamesEditor />
    <AddName />
  </>
}
