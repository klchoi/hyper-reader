// The command palette (Cmd+K): the books, or the chapters of the one open, searched as typed;
// and kept by the server, every place in the book open that says what was typed, and the bookmarks
// that say it (the book's, or with none open, every book's).
import { StoreContext } from './store.ts';
import type { Command } from './store.ts';
import { bookRoute, followedHere } from './places.ts';

export function CommandPalette() @{
  const store = StoreContext.get();
  const choose = (event: MouseEvent, command: Command) => {
    if (!followedHere(event)) return;
    store.selectCommand(store.commands.value.indexOf(command));
    store.runCommand(command);
  };

  <dialog id="command-palette" open={store.palette.value.open}>
    <form onSubmit={(event: SubmitEvent) => { event.preventDefault(); store.runCommand(store.selectedCommand.value); }}>
      <input value={store.palette.value.text} onInput={(event) => store.searchCommands(event.currentTarget.value)} />
      <input type="submit" hidden />
    </form>
    @if (store.book.value && store.mentions.value.q === store.palette.value.q && store.palette.value.q.length >= 2) {
      <small class="mentions">
        {`${store.mentions.value.total} ${store.mentions.value.total === 1 ? 'place says' : 'places say'} it`}
        {store.mentions.value.total > store.mentions.value.found.length ? `, the first ${store.mentions.value.found.length} below` : ''}
        {store.mentions.value.indexed ? '' : ' (the book is being indexed: ask again in a moment for all of them)'}
      </small>
    }
    // made only while open: the palette of a library of thousands lists a few hundred of them
    @if (store.palette.value.open && store.commands.value.length > 0) {
      <ul>
        @for (const command of store.commands.value; key command.key) {
          @if (command.bookmark) {
            <li class={{ bookmark: true, selected: command === store.selectedCommand.value }}>
              <a href={store.router.route(bookRoute(command.open))} onClick={(event: MouseEvent) => choose(event, command)} title={command.bookmark.quote}>
                <small>{[store.book.value ? '' : command.bookmark.bookName, command.bookmark.chapterTitle].filter(Boolean).join(' · ')}</small>
                {command.bookmark.note || command.bookmark.quote}
              </a>
            </li>
          } @else {
            @if (command.mention) {
              <li class={{ mention: true, selected: command === store.selectedCommand.value }}>
                <a href={store.router.route(bookRoute(command.open))} onClick={(event: MouseEvent) => choose(event, command)} title={command.mention.title}>
                  <small>{command.mention.title}</small>
                  {command.mention.before}
                  <mark>{command.mention.match}</mark>
                  {command.mention.after}
                </a>
              </li>
            } @else {
              <li data-term={command.term} class={{ selected: command === store.selectedCommand.value }}>
                <a href={store.router.route(bookRoute(command.open))} onClick={(event: MouseEvent) => choose(event, command)} title={command.label}>{command.label}</a>
              </li>
            }
          }
        }
      </ul>
    }
    @if (store.palette.value.open && store.unlisted.value > 0) {
      <small class="unlisted">{`${store.unlisted.value} more: type to narrow them down`}</small>
    }
  </dialog>
}
