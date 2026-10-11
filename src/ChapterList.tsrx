// The chapters of the book open, down the side: a book's name over the chapters it holds, and
// a chapter written in parts named once, over its parts.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { bookRoute } from './places.ts';

type Row = { key: string; book?: string; id?: string; offset: number; href: string; label: string; tip: string; part: boolean };

export function ChapterList() @{
  const store = StoreContext.get();
  const rows = track<Row[]>(() => {
    let open = store.book.value;
    if (!open) return [];
    let fix = store.fixNames.value;
    let rows: Row[] = [];
    let group: string | undefined;
    let row = (key: string, offset: number, fields: Partial<Row>) => ({
      key, offset, href: store.router.route(bookRoute({ bookId: open.id, offset })), label: '', tip: '', part: false, ...fields,
    });
    open.chapters.forEach((c, i) => {
      // only the chapter that names its book opens a group: the ones after it
      // belong to it until another book is named
      if (c.group && c.group !== group) rows.push(row(`book:${i}`, c.offset, { book: group = c.group }));
      // a chapter in parts is named once, over its parts; the name opens the first
      if (c.part && c.part.of !== open.chapters[i - 1]?.part?.of) rows.push(row(`whole:${i}`, c.offset, { label: fix(c.part.of), tip: fix(c.part.of) }));
      rows.push(row(c.id, c.offset, { id: c.id, label: fix(c.part ? c.part.text : c.title), tip: fix(c.title), part: !!c.part }));
    });
    return rows;
  });
  const activeId = track(() => store.chapter.value?.id);
  const open = (event: MouseEvent, offset: number) => {
    event.preventDefault();
    store.openBook({ bookId: store.book.value!.id, offset });
  };

  <nav>
    @if (rows.value.length > 0) {
      <ol start={0}>
        @for (const row of rows.value; key row.key) {
          @if (row.book) {
            <li class="book">{row.book}</li>
          } @else {
            <li class={{ active: row.id !== undefined && row.id === activeId.value, part: row.part }}>
              <a href={row.href} onClick={(event: MouseEvent) => open(event, row.offset)} title={row.tip}>{row.label}</a>
            </li>
          }
        }
      </ol>
    }
  </nav>
}
