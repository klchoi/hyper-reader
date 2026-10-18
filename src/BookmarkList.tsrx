// The bookmarks of the book open, beside the page in place of its chapters: under the name of the
// chapter each is in, the words its paragraph begins with and its note. The one the reader is at
// is marked as the chapter read is; a row opens its paragraph, and its note can be written, or the
// bookmark taken away. `B` bookmarks the paragraph at the top of the page.
import { track } from 'ripple';
import { bookmarkSays, StoreContext } from './store.ts';
import type { Bookmark } from './backends.ts';
import { bookRoute } from './places.ts';

// a book with more bookmarks than this has a box to narrow them down
const FILTERED = 10;

export function BookmarkList() @{
  const store = StoreContext.get();
  const q = track('');
  // the bookmarks shown, a group to each chapter they are in
  const groups = track(() => {
    let fix = store.fixNames.value;
    let shown = q.value.trim() ? store.bookmarks.value.filter(b => bookmarkSays(b, q.value)) : store.bookmarks.value;
    let groups: { key: string; chapterId: string | null; title: string; bookmarks: Bookmark[] }[] = [];
    for (let b of shown) {
      let last = groups.at(-1);
      if (last && last.chapterId === b.chapterId) last.bookmarks.push(b);
      else groups.push({ key: `${b.chapterId}:${b.id}`, chapterId: b.chapterId, title: fix(b.chapterTitle ?? ''), bookmarks: [b] });
    }
    return groups;
  });
  const open = (event: MouseEvent, b: Bookmark) => {
    event.preventDefault();
    store.toggleChapters(false);
    store.openBook({ bookId: b.bookId, offset: b.offset });
  };

  <div class="bookmarks">
    @if (store.bookmarks.value.length > FILTERED) {
      <input type="search" placeholder="Find a bookmark" value={q.value} onInput={(event) => { q.value = event.currentTarget.value; }} />
    }
    @if (store.bookmarks.value.length === 0) {
      <p class="empty">{'No bookmarks yet. '}<kbd>B</kbd>{' bookmarks the paragraph at the top of the page.'}</p>
    }
    <ol>
      @for (const group of groups.value; key group.key) {
        <>
          <li class="chapter">{group.title}</li>
          @for (const b of group.bookmarks; key b.id) {
            <li class={{ active: b.id === store.bookmarkAt.value?.id }}>
              <a href={store.router.route(bookRoute({ bookId: b.bookId, offset: b.offset }))} onClick={(event: MouseEvent) => open(event, b)} title={store.fixNames.value(b.quote)}>
                <span class="quote">{store.fixNames.value(b.quote)}</span>
                @if (b.note) {
                  <span class="note">{b.note}</span>
                }
              </a>
              <span class="actions">
                <button onClick={() => store.editNote(b.id)} title={b.note ? 'Edit the note' : 'Write a note'}>{'✎'}</button>
                <button onClick={() => store.deleteBookmark(b)} title="Remove the bookmark">{'×'}</button>
              </span>
            </li>
          }
        </>
      }
    </ol>
  </div>
}
