// The books kept, as a table: sorted by a column chosen above it, each with where it was left.
// Kept by the server, the library can be searched (for a character, or for what the books say)
// and its libraries scanned again, from a bar above it.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { bookRoute, formatDate, formatSize } from './places.ts';

export function Library() @{
  const store = StoreContext.get();
  const rows = track(() => {
    let progress = store.progress.value;
    let { field, direction } = store.settings.value.sort;
    let books = store.books.value.map(book => ({ book, kept: progress[book.id] || {} }));
    let compare = (a: (typeof books)[number], z: (typeof books)[number]) => {
      if (field === 'name') return a.book.name.localeCompare(z.book.name, 'vi-VN', { sensitivity: 'accent' });
      if (field === 'size') return a.book.size - z.book.size;
      if (field === 'updatedAt') return new Date(a.kept.updatedAt || 0).getTime() - new Date(z.kept.updatedAt || 0).getTime();
      if (field === 'chapterCount') return (a.kept.chapterCount || 1) - (z.kept.chapterCount || 1);
      return 0;
    };
    return books
      .sort((a, z) => (direction === 'desc' ? -compare(a, z) || 0 : compare(a, z)))
      .map(({ book, kept }) => {
        let place = { bookId: book.id, offset: kept.offset, chapterId: kept.chapterId };
        return {
          id: book.id,
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
    <a class="th text-left" data-sort={sorted('name')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'name')}><span>File</span></a>
    <a class="th text-right" data-sort={sorted('size')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'size')}><span>Size</span></a>
    <a class="th text-right" data-sort={sorted('chapterCount')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'chapterCount')}><span>Chapters</span></a>
    <a class="th text-right" data-sort={sorted('updatedAt')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'updatedAt', 'desc')}><span>Date</span></a>
    <span class="th"><span /></span>
    @for (const row of searched.value ? [] : rows.value; key row.id) {
      <>
        <div class="td">
          <a class="name" href={row.href} onClick={(event: MouseEvent) => { event.preventDefault(); store.openBook(row.place); }}>{row.name}</a>
          @if (row.description) {
            <small class="desc">{row.description}</small>
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
      </>
    }
  </div>
}
