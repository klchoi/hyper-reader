// The books kept, as a table: sorted by a column chosen above it, each with where it was left.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { bookRoute, formatDate, formatSize } from './places.ts';

export function Library() @{
  const store = StoreContext.get();
  const rows = track(() => {
    let progress = store.progress.value;
    let { field, direction } = store.settings.value.sort;
    let books = store.files.value.map(file => ({ file, book: store.parser.Book(file), kept: progress[store.parser.Book(file).id] || {} }));
    let compare = (a: (typeof books)[number], z: (typeof books)[number]) => {
      if (field === 'name') return a.book.name.localeCompare(z.book.name, 'vi-VN', { sensitivity: 'accent' });
      if (field === 'size') return a.file.size - z.file.size;
      if (field === 'updatedAt') return new Date(a.kept.updatedAt || 0).getTime() - new Date(z.kept.updatedAt || 0).getTime();
      if (field === 'chapterCount') return (a.kept.chapterCount || 1) - (z.kept.chapterCount || 1);
      return 0;
    };
    return books
      .sort((a, z) => (direction === 'desc' ? -compare(a, z) || 0 : compare(a, z)))
      .map(({ file, book, kept }) => {
        let place = { bookId: book.id, offset: kept.offset, chapterId: kept.chapterId };
        return {
          id: book.id,
          name: book.name,
          description: book.description,
          place,
          href: store.router.route(bookRoute(place)),
          size: formatSize(file.size),
          chapters: !kept.chapterCount ? '-' : `${kept.chapterIndex}/${kept.chapterCount}`,
          date: formatDate(kept.updatedAt) || '-',
        };
      });
  });
  // the column the books are sorted by says which way
  const sorted = (field: string) => (store.settings.value.sort.field === field ? store.settings.value.sort.direction : undefined);
  const sortBy = (event: MouseEvent, field: string, first: 'asc' | 'desc' = 'asc') => {
    event.preventDefault();
    store.sortBy(field, first);
  };

  <div class="table">
    <a class="th text-left" data-sort={sorted('name')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'name')}><span>File</span></a>
    <a class="th text-right" data-sort={sorted('size')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'size')}><span>Size</span></a>
    <a class="th text-right" data-sort={sorted('chapterCount')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'chapterCount')}><span>Chapters</span></a>
    <a class="th text-right" data-sort={sorted('updatedAt')} href="#" onClick={(event: MouseEvent) => sortBy(event, 'updatedAt', 'desc')}><span>Date</span></a>
    <span class="th"><span /></span>
    @for (const row of rows.value; key row.id) {
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
          <a class="delete" onClick={() => store.deleteBook(row.id)}><small>delete</small></a>
        </div>
      </>
    }
  </div>
}
