// The command palette (Cmd+K): the books, or the chapters of the one open, searched as typed.
import { StoreContext } from './store.ts';
import type { Command } from './store.ts';
import { bookRoute } from './places.ts';

export function CommandPalette() @{
  const store = StoreContext.get();
  const choose = (event: MouseEvent, command: Command) => {
    event.preventDefault();
    store.selectCommand(store.commands.value.indexOf(command));
    store.runCommand(command);
  };

  <dialog id="command-palette" open={store.palette.value.open}>
    <form onSubmit={(event: SubmitEvent) => { event.preventDefault(); store.runCommand(store.selectedCommand.value); }}>
      <input onInput={(event) => store.searchCommands(event.currentTarget.value)} />
      <input type="submit" hidden />
    </form>
    @if (store.commands.value.length > 0) {
      <ul>
        @for (const command of store.commands.value; key command.key) {
          <li data-term={command.term} class={{ selected: command === store.selectedCommand.value }}>
            <a href={store.router.route(bookRoute(command.open))} onClick={(event: MouseEvent) => choose(event, command)} title={command.label}>{command.label}</a>
          </li>
        }
      </ul>
    }
  </dialog>
}
