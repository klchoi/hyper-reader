// The chapters of the book open, down the side: a book's name over the chapters it holds, and
// a chapter written in parts named once, over its parts. A chapter is shown by its number and
// its name (`Chương 12: Tên` and `Hồi 12: Tên` as `12. Tên`), the numbers in a column of their
// own. A part is listed under its chapter's name, by the chapter it is when it is one of the
// chapters its whole runs over (`9.`, and the whole by its name alone), or as it is written.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { bookRoute } from './places.ts';

// a row: a book's name, a chapter or one of its parts, or the name of a chapter in parts (with
// the ids of its parts). `number` and `label` are what is shown, `tip` the title in full
type Row = {
  key: string; book?: string; id?: string; offset: number; href: string;
  number?: string; label: string; tip: string; part?: boolean; parts?: string[];
};

// `Chương 12: Tên`, `Hồi 12: Tên`, `Chương 3 (thượng)`, `Chương 1-6`, `Chương kết` as their
// number and the rest
const NUMBERED = /^(?:Chương|Hồi) (\S+?)(?::\s+|\s+(?=\()|$)(.*)$/u;
const numbered = (title: string): { number?: string; label: string } => {
  let found = NUMBERED.exec(title);
  return found ? { number: found[1], label: found[2] } : { label: title };
};

export function ChapterList() @{
  const store = StoreContext.get();
  const rows = track<Row[]>(() => {
    let open = store.book.value;
    if (!open) return [];
    let fix = store.fixNames.value;
    let rows: Row[] = [];
    let group: string | undefined;
    let whole: Row | undefined;
    let row = (key: string, offset: number, fields: Partial<Row>): Row => ({
      key, offset, href: store.router.route(bookRoute({ bookId: open.id, offset })), label: '', tip: '', ...fields,
    });
    let chapter = (title: string) => ({ ...numbered(fix(title)), tip: fix(title) });
    open.chapters.forEach((c, i) => {
      // only the chapter that names its book opens a group: the ones after it
      // belong to it until another book is named
      if (c.group && c.group !== group) rows.push(row(`book:${i}`, c.offset, { book: group = c.group }));
      // a chapter in parts is named once, over its parts; the name opens the first
      if (c.part && c.part.of !== open.chapters[i - 1]?.part?.of) {
        let named = chapter(c.part.of);
        // parts that are its chapters say their numbers: the whole is named without them
        if (c.part.chapter != null) named.number = '';
        rows.push(whole = row(`whole:${i}`, c.offset, { ...named, parts: [] }));
      }
      if (c.part) whole?.parts?.push(c.id);
      let shown: Partial<Row> = !c.part ? chapter(c.title)
        : c.part.chapter != null ? { number: String(c.part.chapter), label: fix(c.part.text), tip: fix(c.title), part: true }
        : { label: fix(c.part.text), tip: fix(c.title), part: true };
      rows.push(row(c.id, c.offset, { id: c.id, ...shown }));
    });
    return rows;
  });
  // the column the numbers stand in is as wide as the longest of a single chapter; a run
  // (`152-153`) or `kết` takes what more it needs
  const digits = track(() => Math.max(1, ...rows.value.map(row => /^\d+$/.test(row.number ?? '') ? row.number!.length : 0)));
  const activeId = track(() => store.chapter.value?.id);
  const open = (event: MouseEvent, offset: number) => {
    event.preventDefault();
    store.openBook({ bookId: store.book.value!.id, offset });
  };

  <nav>
    @if (rows.value.length > 0) {
      <ol start={0} style={`--digits: ${digits.value}`}>
        @for (const row of rows.value; key row.key) {
          @if (row.book) {
            <li class="book">{row.book}</li>
          } @else {
            // the name of a chapter in parts is written out whole while one of its parts is read
            // the link is as wide as the list, the entry (and its highlight) as wide as its text
            <li class={{ active: row.id !== undefined && row.id === activeId.value, part: !!row.part, reading: !!activeId.value && !!row.parts?.includes(activeId.value) }}>
              <a href={row.href} onClick={(event: MouseEvent) => open(event, row.offset)} title={row.tip} aria-label={row.tip}>
                <span class="entry">
                  @if (row.number !== undefined) {
                    <span class="number">{row.number}</span>
                  }
                  <span class="name">{row.label}</span>
                </span>
              </a>
            </li>
          }
        }
      </ol>
    }
  </nav>
}
