// The note of a bookmark of the book open, written over the page: as soon as `B` bookmarks a
// paragraph, or when asked for. Enter saves it, Escape puts it away (the bookmark is kept either
// way); the bookmark can be taken away from here too.
import { track } from 'ripple';
import { StoreContext } from './store.ts';

export function BookmarkNote() @{
  const store = StoreContext.get();
  const bookmark = track(() => store.bookmarks.value.find(b => b.id === store.noting.value));
  const save = (event: SubmitEvent) => {
    event.preventDefault();
    let b = bookmark.value;
    let input = (event.currentTarget as HTMLFormElement).querySelector('input');
    if (b && input) store.saveNote(b, input.value);
  };

  <dialog id="bookmark-note" open={!!bookmark.value}>
    @if (bookmark.value) {
      <form onSubmit={save}>
        <small class="quote">{store.fixNames.value(bookmark.value.quote)}</small>
        <input
          placeholder="Add a note (optional)"
          value={bookmark.value.note}
          onKeyDown={(event: KeyboardEvent) => { if (event.key === 'Escape') store.editNote(null); }}
        />
        <div class="buttons">
          <button type="button" class="remove" onClick={() => bookmark.value && store.deleteBookmark(bookmark.value)}>Remove bookmark</button>
          <button type="button" onClick={() => store.editNote(null)}>Close</button>
          <button type="submit">Save</button>
        </div>
      </form>
    }
  </dialog>
}
