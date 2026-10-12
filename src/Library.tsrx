// The books kept, as a table: sorted by a column chosen above it, each with where it was left.
// Kept by the server, the library can be searched (for a character, or for what the books say)
// and its libraries scanned again, from a bar above it.
//
// A library may hold thousands of books, and a row for each is more than a page can make, or
// sort, in good time. So the rows are all one height, over a list as tall as all of them, and
// only those in sight are made (and a few around them), as the window scrolls.
import { effect, track } from 'ripple';
import { StoreContext } from './store.ts';
import { bookRoute, formatDate, formatSize } from './places.ts';

// the rows made above and below those in sight, so a quick scroll finds them there
const AROUND = 10;
// (a collator made once: localeCompare makes one for every two names it compares)
const byName = new Intl.Collator('vi-VN', { sensitivity: 'accent' });

export function Library() @{
  const store = StoreContext.get();
  // every book, with where it was left, in the order chosen
  const books = track(() => {
    let progress = store.progress.value;
    let { field, direction } = store.settings.value.sort;
    let entries = store.books.value.map(book => {
      let kept = progress[book.id] || {};
      return { book, kept, updated: new Date(kept.updatedAt || 0).getTime() };
    });
    let compare = (a: (typeof entries)[number], z: (typeof entries)[number]) => {
      if (field === 'name') return byName.compare(a.book.name, z.book.name);
      if (field === 'size') return a.book.size - z.book.size;
      if (field === 'updatedAt') return a.updated - z.updated;
      if (field === 'chapterCount') return (a.kept.chapterCount || 1) - (z.kept.chapterCount || 1);
      return 0;
    };
    return entries.sort((a, z) => (direction === 'desc' ? -compare(a, z) || 0 : compare(a, z)));
  });
  // the rows in sight, by where the list stands in the window: those from `first` up to `last`
  // (at first as many as the window could hold, the list not being there to measure yet)
  const range = track({ first: 0, last: Math.ceil(innerHeight / 40) + AROUND });
  let list: HTMLDivElement | undefined;
  let frame = 0;
  const measure = () => {
    frame = 0;
    if (!list) return;
    let above = -list.getBoundingClientRect().top;
    let height = list.firstElementChild?.getBoundingClientRect().height || 60;
    let first = Math.max(0, Math.floor(above / height) - AROUND);
    let last = Math.max(first, Math.ceil((above + innerHeight) / height) + AROUND);
    if (first !== range.value.first || last !== range.value.last) range.value = { first, last };
  };
  // once a frame however often the window says it moved
  const measureSoon = () => { frame ||= requestAnimationFrame(measure); };
  effect(() => {
    addEventListener('scroll', measureSoon, { passive: true });
    addEventListener('resize', measureSoon);
    return () => {
      removeEventListener('scroll', measureSoon);
      removeEventListener('resize', measureSoon);
      cancelAnimationFrame(frame);
    };
  });
  const rows = track(() => {
    let { first, last } = range.value;
    return books.value.slice(first, last).map(({ book, kept }, k) => {
      let place = { bookId: book.id, offset: kept.offset, chapterId: kept.chapterId };
      return {
        id: book.id,
        at: first + k,
        name: book.name,
        description: book.description,
        place,
        href: store.router.route(bookRoute(place)),
        size: formatSize(book.size),
        deletable: book.deletable,
        chapters: !kept.chapterCount ? '-' : `${kept.chapterIndex}/${kept.chapterCount}`,
        date: formatDate(kept.updatedAt) || '-',
      };
    });
  });
  // what the bar says of the libraries: how many books, a scan going, the index behind
  const said = track(() => {
    let now = store.status.value;
    if (!now) return '';
    let { scan, index } = now;
    let parts = [`${now.books} books`];
    if (scan.running) parts.push(scan.toRead ? `reading ${scan.read}/${scan.toRead}` : 'looking for books');
    if (index.done < index.total) parts.push(`indexed ${index.done}/${index.total}`);
    return parts.join(' · ');
  });
  const searched = track(() => store.found.value.q !== '');
  // measured again when the list changes under the window: the books come, a search is left
  effect(() => {
    if (!searched.value && books.value.length > 0) measureSoon();
  });

  // the column the books are sorted by says which way
  const sorted = (field: string) => (store.settings.value.sort.field === field ? store.settings.value.sort.direction : undefined);
  const sortBy = (event: MouseEvent, field: string, first: 'asc' | 'desc' = 'asc') => {
    event.preventDefault();
    store.sortBy(field, first);
  };

  <div class="table">
    @if (store.searching.value) {
      <div class="bar">
        <input type="search" placeholder="Search for a character, or for what the books say" onInput={(event) => store.searchLibrary(event.currentTarget.value)} />
        <small>{said.value}</small>
        <button onClick={() => store.rescan()} disabled={store.status.value?.scan.running} title="Read again what came, changed or went in the libraries">Rescan</button>
      </div>
    }
    @if (searched.value) {
      <div class="found">
        @if (store.found.value.characters.length > 0) {
          <>
          <h3>Characters</h3>
          @for (const person of store.found.value.characters; key person.name) {
            <div class="person">
              <b>{person.name}</b>
              <small>{` ${person.mentions} mentions, in ${person.books.length} ${person.books.length === 1 ? 'book' : 'books'}`}</small>
              <ul>
                @for (const named of person.books; key named.id) {
                  <li>
                    <a href={store.router.route({ book: named.id })} onClick={(event: MouseEvent) => { event.preventDefault(); store.openFound(named.id, person.name); }}>{named.name}</a>
                    <small>{` ${named.mentions}`}</small>
                  </li>
                }
              </ul>
            </div>
          }
          </>
        }
        <h3>{store.found.value.books.length > 0 ? `Said in ${store.found.value.books.length} ${store.found.value.books.length === 1 ? 'book' : 'books'}` : 'Said in no book indexed'}</h3>
        @for (const saying of store.found.value.books; key saying.id) {
          <p>
            <a class="name" href={store.router.route({ book: saying.id })} onClick={(event: MouseEvent) => { event.preventDefault(); store.openFound(saying.id, store.found.value.q); }}>{saying.name}</a>
            <small>{` ${saying.chapters} ${saying.chapters === 1 ? 'chapter' : 'chapters'}`}</small>
          </p>
        }
      </div>
    }
    <div class="row head">
      <a class="th text-left" data-sort={sorted('name')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'name')}><span>File</span></a>
      <a class="th text-right" data-sort={sorted('size')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'size')}><span>Size</span></a>
      <a class="th text-right" data-sort={sorted('chapterCount')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'chapterCount')}><span>Chapters</span></a>
      <a class="th text-right" data-sort={sorted('updatedAt')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'updatedAt', 'desc')}><span>Date</span></a>
      <span class="th"><span /></span>
    </div>
    @if (!searched.value) {
      <div class="rows" ref={list} style={`--rows: ${books.value.length}`}>
        @for (const row of rows.value; key row.id) {
          <div class="row" style={`--at: ${row.at}`}>
            <div class="td">
              <a class="name" href={row.href} title={row.name} onClick={(event: MouseEvent) => { event.preventDefault(); store.openBook(row.place); }}>{row.name}</a>
              @if (row.description) {
                <small class="desc" title={row.description}>{row.description}</small>
              }
            </div>
            <div class="td text-right"><small>{row.size}</small></div>
            <div class="td text-right"><small>{row.chapters}</small></div>
            <div class="td text-right"><small>{row.date}</small></div>
            <div class="td">
              @if (row.deletable) {
                <a class="delete" onClick={() => store.deleteBook(row.id)}><small>delete</small></a>
              }
            </div>
          </div>
        }
      </div>
    }
  </div>
}
