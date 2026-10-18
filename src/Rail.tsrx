// The buttons down the other side: back to the library, and for the book open, reading it
// again, zen, and its names (and its chapters, on a narrow screen), and the paragraph at the top of
// the page bookmarked (or no longer); and at the foot, the cog that opens the settings.
import { StoreContext } from './store.ts';
import { followedHere } from './places.ts';

export function Rail() @{
  const store = StoreContext.get();

  <aside class="rail">
    @if (store.chapter.value) {
      <>
        <div>
          <a
            class="close"
            href={store.router.route({})}
            onClick={(event: MouseEvent) => { if (followedHere(event)) store.showLibrary(); }}
            title="Back to bookshelf"
          />
        </div>
        <div>
          // only where the window is too narrow for the chapter list beside the page
          <button
            class={['chapters', { selected: store.chaptersOpen.value }]}
            onClick={() => store.toggleChapters()}
            title="Chapters and bookmarks"
            aria-expanded={store.chaptersOpen.value}
          />
          <button
            class={['bookmark', { selected: !!store.bookmarkHere.value }]}
            onClick={() => store.toggleBookmark()}
            title={store.bookmarkHere.value ? 'Remove the bookmark here (B)' : 'Bookmark this paragraph (B)'}
            aria-pressed={!!store.bookmarkHere.value}
          />
          <button class="refresh" onClick={() => store.refreshBook()} title="Refresh book" />
          <button class="zen" onClick={() => store.saveSettings({ zen: !store.settings.value.zen })} title="Toggle Zen Mode" />
          <button class="names-editor" onClick={() => store.toggleNamesEditor(true)} title="Edit names" />
        </div>
      </>
    }
    <div class="foot">
      <button
        class={['cog', { selected: store.settingsOpen.value }]}
        onClick={() => store.toggleSettings()}
        title="Settings"
        aria-expanded={store.settingsOpen.value}
        aria-controls="settings"
      />
    </div>
  </aside>
}
