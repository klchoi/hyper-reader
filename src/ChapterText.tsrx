// The chapter open, a paragraph to a line, each marked with the offset it starts at in the book
// (see places.ts): a rule, a line of marks set apart, or prose with its links.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { chapterLines, lineKind, linePieces } from './places.ts';

export function ChapterText() @{
  const store = StoreContext.get();
  const lines = track(() => {
    let chapter = store.chapter.value;
    if (!chapter) return [];
    return chapterLines(chapter, store.fixNames.value).map(line => ({ ...line, kind: lineKind(line.text), pieces: linePieces(line.text) }));
  });

  <main>
    <article>
      @for (const line of lines.value; key line.offset) {
        @if (line.kind === 'rule') {
          <hr data-offset={line.offset} />
        } @else {
          @if (line.kind === 'marks') {
            <p data-offset={line.offset} class="text-center indent-none">{line.text}</p>
          } @else {
            @if (line.pieces.length === 1 && typeof line.pieces[0] === 'string') {
              <p data-offset={line.offset}>{line.text}</p>
            } @else {
              <p data-offset={line.offset}>
                @for (const piece of line.pieces) {
                  @if (typeof piece === 'string') {
                    <>{piece}</>
                  } @else {
                    <a href={piece.href} target="_blank">{piece.href}</a>
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
