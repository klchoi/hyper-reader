// The library: its front (the books being read, the newest, a few at random, and the tags most
// books have), and what it is asked for (words of a title, tags, a size, a length, an order), a
// page at a time. The backend looks through the books (see catalog.ts): the page only ever holds
// the few it shows. Kept by the server, the library can also be searched for what its books say
// and the characters they name, and its libraries scanned again. The bookmarks of every book are
// on its front too (the newest), above the books its search finds (those that say the words asked
// for), and all of them, searched, where asked for.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { bookRoute, formatDate, formatSize } from './places.ts';
import type { Query, Range, Shelved, Sort } from './catalog.ts';
import type { Bookmark } from './backends.ts';

// what the library can be narrowed to, and ordered by
const SIZES: { label: string; range?: Range }[] = [
  { label: 'Any size' },
  { label: 'Under 1 MB', range: [null, 1e6] },
  { label: '1–5 MB', range: [1e6, 5e6] },
  { label: '5–20 MB', range: [5e6, 2e7] },
  { label: 'Over 20 MB', range: [2e7, null] },
];
const LENGTHS: { label: string; range?: Range }[] = [
  { label: 'Any length' },
  { label: 'Under 50 chapters', range: [null, 49] },
  { label: '50–200', range: [50, 200] },
  { label: '200–1,000', range: [201, 1000] },
  { label: 'Over 1,000', range: [1001, null] },
];
const SORTS: { label: string; sort?: Sort }[] = [
  { label: 'Best match' },
  { label: 'Newest', sort: 'latest' },
  { label: 'Last read', sort: 'read' },
  { label: 'Title', sort: 'title' },
  { label: 'Largest', sort: 'size' },
  { label: 'Most chapters', sort: 'chapters' },
  { label: 'Random', sort: 'random' },
];
const sameRange = (a?: Range, b?: Range) => (a?.[0] ?? null) === (b?.[0] ?? null) && (a?.[1] ?? null) === (b?.[1] ?? null);
// the day a file is from, as 2024-02-11
const dayOf = (ms: number) => (ms ? new Date(ms).toLocaleDateString('sv-SE') : '');

type Section = { key: string; title: string; books: Shelved[]; all?: Query; shuffle?: boolean; more?: boolean };

// a bookmark as the library lists it: its book (unless it is listed under it), its chapter and
// when it was made or its note written, the words its paragraph begins with, and its note. One
// whose book is not in the library is only told of
function BookmarkRow(props: { bookmark: Bookmark; withBook?: boolean }) @{
  const store = StoreContext.get();
  const open = (event: MouseEvent) => {
    event.preventDefault();
    store.findAllBookmarks(null);
    store.openBook({ bookId: props.bookmark.bookId, offset: props.bookmark.offset });
  };

  <li class={{ bookmark: true, missing: !!props.bookmark.missing }}>
    @if (props.withBook) {
      <span class="title">{props.bookmark.bookName}</span>
    }
    <small class="facts">
      {[props.bookmark.chapterTitle, formatDate(props.bookmark.updatedAt), props.bookmark.missing && 'not in the library'].filter(Boolean).join(' · ')}
    </small>
    @if (props.bookmark.missing) {
      <span class="quote">{props.bookmark.quote}</span>
    } @else {
      <a class="quote" href={store.router.route(bookRoute({ bookId: props.bookmark.bookId, offset: props.bookmark.offset }))} onClick={open}>{props.bookmark.quote}</a>
    }
    @if (props.bookmark.note) {
      <span class="note">{props.bookmark.note}</span>
    }
  </li>
}

export function Library() @{
  const store = StoreContext.get();
  const filtersOpen = track(false);
  const asked = track<Query>(() => store.finding.value?.query ?? {});
  const narrowed = track(() => !!(asked.value.size || asked.value.chapters || asked.value.sort));
  // what is asked, changed: the library's front again once nothing is
  const ask = (change: Query, wait = 0) => {
    let query = { ...asked.value, ...change };
    if ('q' in change) store.searchLibrary('');
    store.findAllBookmarks(null);
    // the files of one book are left for anything else asked
    if (!('title' in change)) delete query.title;
    let something = query.q?.trim() || query.tags?.length || query.size || query.chapters || query.sort || query.title != null;
    store.find(something ? query : null, wait);
  };
  const withTag = (tag: string) => ask({ tags: [...new Set([...(asked.value.tags ?? []), tag])] });

  const sections = track<Section[]>(() => {
    let now = store.finding.value;
    if (now) {
      let what = now.query.title != null ? (now.total === 1 ? 'file' : 'files') : now.total === 1 ? 'book' : 'books';
      let title = now.busy && !now.books.length ? 'Looking…' : `${now.total.toLocaleString()} ${what}`;
      return [{ key: 'found', title, books: now.books, more: now.books.length < now.total }];
    }
    let front = store.shelves.value;
    if (!front) return [];
    let shown: Section[] = [
      { key: 'reading', title: 'Continue reading', books: front.reading, all: { sort: 'read' } },
      { key: 'latest', title: 'New & updated', books: front.latest, all: { sort: 'latest' } },
      { key: 'random', title: 'Something different', books: front.random, shuffle: true },
    ];
    return shown.filter(section => section.books.length > 0);
  });
  // a book as a row shows it
  const placeOf = (book: Shelved) => ({ bookId: book.id, offset: book.read?.offset, chapterId: book.read?.chapterId });
  // (the files of one book are told apart by what their names say of them: `1-66 chương`)
  const factsOf = (book: Shelved) => [
    formatSize(book.size), `${book.chapters.toLocaleString()} ${book.chapters === 1 ? 'chapter' : 'chapters'}`, dayOf(book.date), book.folder,
    store.finding.value?.query.title != null && book.note,
  ].filter(Boolean).join(' · ');
  // every bookmark asked for, a group to each book, in the order they came (the newest first)
  const bookmarkGroups = track(() => {
    let groups: { key: string; bookName: string; bookmarks: Bookmark[] }[] = [];
    for (let b of store.allBookmarks.value?.bookmarks ?? []) {
      let last = groups.at(-1);
      if (last && last.key.startsWith(`${b.bookId}:`)) last.bookmarks.push(b);
      else groups.push({ key: `${b.bookId}:${b.id}`, bookName: b.bookName, bookmarks: [b] });
    }
    return groups;
  });
  const readOf = (book: Shelved) => (book.read?.chapterCount ? `Chapter ${book.read.chapterIndex} of ${book.read.chapterCount}, ${formatDate(book.read.updatedAt) ?? ''}` : '');
  const open = (event: MouseEvent, book: Shelved) => {
    event.preventDefault();
    store.openBook(placeOf(book));
  };

  // what the bar says of the libraries: how many books, a scan going, the index behind
  const said = track(() => {
    let now = store.status.value;
    if (!now) return '';
    let { scan, index } = now;
    let parts = [`${now.books.toLocaleString()} books`];
    if (scan.running) parts.push(scan.toRead ? `reading ${scan.read}/${scan.toRead}` : 'looking for books');
    if (index.done < index.total) parts.push(`indexed ${index.done}/${index.total}`);
    return parts.join(' · ');
  });

  <div class="library">
    <div class="find">
      <input type="search" placeholder="Find a book: a title, a tag, a folder" value={asked.value.q ?? ''} onInput={(event) => ask({ q: event.currentTarget.value }, 250)} />
      <button class={{ selected: filtersOpen.value || narrowed.value }} aria-expanded={filtersOpen.value} onClick={() => { filtersOpen.value = !filtersOpen.value; }}>Filters</button>
    </div>
    @if (filtersOpen.value) {
      <div class="filters">
        <div class="choices">
          @for (const size of SIZES; key size.label) {
            <button class={{ selected: sameRange(asked.value.size, size.range) }} onClick={() => ask({ size: size.range })}>{size.label}</button>
          }
        </div>
        <div class="choices">
          @for (const length of LENGTHS; key length.label) {
            <button class={{ selected: sameRange(asked.value.chapters, length.range) }} onClick={() => ask({ chapters: length.range })}>{length.label}</button>
          }
        </div>
        <div class="choices">
          @for (const order of SORTS; key order.label) {
            <button class={{ selected: asked.value.sort === order.sort }} onClick={() => ask({ sort: order.sort, seed: order.sort === 'random' ? Math.floor(Math.random() * 2 ** 31) : undefined })}>{order.label}</button>
          }
        </div>
      </div>
    }
    @if ((asked.value.tags ?? []).length > 0) {
      <div class="tags asked">
        @for (const tag of asked.value.tags ?? []; key tag) {
          <button class="tag selected" title="Leave this tag out" onClick={() => ask({ tags: (asked.value.tags ?? []).filter(t => t !== tag) })}>{`${tag} ×`}</button>
        }
      </div>
    }

    @if (store.allBookmarks.value) {
      <section class="all-bookmarks">
        <h2>
          <span>{store.allBookmarks.value.busy && !store.allBookmarks.value.bookmarks.length ? 'Looking…' : `${store.allBookmarks.value.total.toLocaleString()} ${store.allBookmarks.value.total === 1 ? 'bookmark' : 'bookmarks'}`}</span>
          <button class="link" onClick={() => store.findAllBookmarks(null)}>Back</button>
        </h2>
        <input type="search" class="filter" placeholder="Find a bookmark: its note, its words, its book or chapter" value={store.allBookmarks.value.q} onInput={(event) => store.findAllBookmarks(event.currentTarget.value, 250)} />
        @for (const group of bookmarkGroups.value; key group.key) {
          <>
            <h3>{group.bookName}</h3>
            <ol class="books">
              @for (const b of group.bookmarks; key b.id) {
                <BookmarkRow bookmark={b} />
              }
            </ol>
          </>
        }
        @if (store.allBookmarks.value.bookmarks.length < store.allBookmarks.value.total) {
          <button class="more" disabled={store.allBookmarks.value.busy} onClick={() => store.findMoreBookmarks()}>Show more</button>
        }
      </section>
    } @else {
    @if (store.found.value.q) {
      // what the books say, and the characters they name (the server's index)
      <section class="found">
        <h2>
          <span>{`“${store.found.value.q}” in the books`}</span>
          <button class="link" onClick={() => store.searchLibrary('')}>Back</button>
        </h2>
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
            <a class="title" href={store.router.route({ book: saying.id })} onClick={(event: MouseEvent) => { event.preventDefault(); store.openFound(saying.id, store.found.value.q); }}>{saying.name}</a>
            <small>{` ${saying.chapters} ${saying.chapters === 1 ? 'chapter' : 'chapters'}`}</small>
          </p>
        }
      </section>
    } @else {
      <>
        @if (store.shelves.value && !store.finding.value && store.shelves.value.latest.length === 0) {
          <p class="empty">No books yet: drop .txt files on the page to add them.</p>
        }
        // the bookmarks that say the words asked for, above the books
        @if (store.finding.value && store.foundBookmarks.value.bookmarks.length > 0) {
          <section>
            <h2>
              <span>{`In your bookmarks: ${store.foundBookmarks.value.total.toLocaleString()}`}</span>
              <button class="link" onClick={() => store.findAllBookmarks(store.foundBookmarks.value.q)}>See all</button>
            </h2>
            <ol class="books">
              @for (const b of store.foundBookmarks.value.bookmarks; key b.id) {
                <BookmarkRow bookmark={b} withBook={true} />
              }
            </ol>
          </section>
        }
        @for (const section of sections.value; key section.key) {
          <section>
            <h2>
              <span>{section.title}</span>
              @if (section.all) {
                <button class="link" onClick={() => ask(section.all!)}>See all</button>
              }
              @if (section.shuffle) {
                <button class="link" onClick={() => store.shuffle()}>Shuffle</button>
              }
              @if (section.key === 'found') {
                <button class="link" onClick={() => { filtersOpen.value = false; store.find(null); }}>Back</button>
              }
            </h2>
            <ol class="books">
              @for (const book of section.books; key book.id) {
                <li>
                  <a class="title" href={store.router.route(bookRoute(placeOf(book)))} onClick={(event: MouseEvent) => open(event, book)}>{book.title}</a>
                  <small class="facts">
                    {factsOf(book)}
                    @if (book.versions && store.finding.value?.query.title == null) {
                      <>
                        {' · '}
                        <button class="link" title="Every file of this book, the older ones too" onClick={() => ask({ title: book.title, q: '', tags: [], size: undefined, chapters: undefined, sort: undefined })}>{`${book.versions} files`}</button>
                      </>
                    }
                  </small>
                  @if (book.read?.chapterCount) {
                    <small class="read">{readOf(book)}</small>
                  }
                  @if (book.tags.length > 0 || book.deletable) {
                    <span class="tags">
                      @for (const tag of book.tags; key tag) {
                        <button class="tag" onClick={() => withTag(tag)}>{tag}</button>
                      }
                      @if (book.deletable) {
                        <button class="link delete" onClick={() => store.deleteBook(book.id)}>delete</button>
                      }
                    </span>
                  }
                </li>
              }
            </ol>
            @if (section.more) {
              <button class="more" disabled={store.finding.value?.busy} onClick={() => store.findMore()}>Show more</button>
            }
            @if (section.key === 'found' && asked.value.q?.trim()) {
              <button class="link inside" onClick={() => store.searchLibrary(asked.value.q ?? '')}>{`Search what the books say for “${asked.value.q?.trim()}”`}</button>
            }
          </section>
        }
        @if (!store.finding.value && store.recentBookmarks.value.length > 0) {
          <section>
            <h2>
              <span>Bookmarks</span>
              <button class="link" onClick={() => store.findAllBookmarks('')}>See all</button>
            </h2>
            <ol class="books">
              @for (const b of store.recentBookmarks.value; key b.id) {
                <BookmarkRow bookmark={b} withBook={true} />
              }
            </ol>
          </section>
        }
        @if (!store.finding.value && (store.shelves.value?.tags.length ?? 0) > 0) {
          <section>
            <h2><span>Tags</span></h2>
            <div class="tags">
              @for (const counted of store.shelves.value?.tags ?? []; key counted.tag) {
                <button class="tag" onClick={() => withTag(counted.tag)}>{counted.tag}<small>{` ${counted.count}`}</small></button>
              }
            </div>
          </section>
        }
      </>
    }
    }

    @if (said.value) {
      <footer>
        <small>{said.value}</small>
        <button class="link" onClick={() => store.rescan()} disabled={store.status.value?.scan.running} title="Read again what came, changed or went in the libraries">Rescan</button>
      </footer>
    }
  </div>
}
