// The chapter open, a paragraph to a line, each marked with the offset it starts at in the book
// (the backend's lines, see marks.ts): a rule, a line of marks set apart, or prose with its links,
// and what the list says a person is beside each of their names (no part of the text). A paragraph
// bookmarked has a ribbon in the margin, which opens its note.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { lineKind, linePieces } from './places.ts';
import { genderNames, genderSaid, genderSymbols, piecesSaying } from './marks.ts';

export function ChapterText() @{
  const store = StoreContext.get();
  const lines = track(() => {
    let shown = store.shown.value;
    let said = genderSaid(shown);
    return (shown?.lines ?? []).map((line, i) => ({ ...line, kind: lineKind(line.text), pieces: piecesSaying(linePieces(line.text), said.get(i) ?? []) }));
  });
  const marked = track(() => new Set(store.bookmarks.value.map(b => b.offset)));

  <main>
    <article>
      @for (const line of lines.value; key line.offset) {
        @if (line.kind === 'rule') {
          <hr data-offset={line.offset} />
        } @else {
          @if (line.kind === 'marks') {
            <p data-offset={line.offset} class={['text-center', 'indent-none', { bookmarked: marked.value.has(line.offset) }]}>{line.text}</p>
          } @else {
            @if (line.pieces.length === 1 && typeof line.pieces[0] === 'string') {
              <p data-offset={line.offset} class={{ bookmarked: marked.value.has(line.offset) }}>{line.text}</p>
            } @else {
              <p data-offset={line.offset} class={{ bookmarked: marked.value.has(line.offset) }}>
                @for (const piece of line.pieces) {
                  @if (typeof piece === 'string') {
                    <>{piece}</>
                  } @else {
                    @if ('href' in piece) {
                      <a href={piece.href} target="_blank">{piece.href}</a>
                    } @else {
                      <sup
                        class="gender"
                        title={genderNames[piece.gender]}
                        aria-label={genderNames[piece.gender]}
                        style="font-size: 0.55em; opacity: 0.6; margin-inline-start: 0.15em; user-select: none"
                      >{genderSymbols[piece.gender]}</sup>
                    }
                  }
                }
              </p>
            }
          }
        }
      }
    </article>
  </main>
}
