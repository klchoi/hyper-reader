// The names of the book open, one person to a line, edited as text: saved with the button or
// Cmd+Enter, put away with Escape.
import { StoreContext } from './store.ts';

export function NamesEditor() @{
  const store = StoreContext.get();
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') store.toggleNamesEditor(false);
    else if (event.key === 'Enter' && event.metaKey) store.saveNames();
  };

  <dialog id="names-editor" open={store.namesEditorOpen.value}>
    <form onSubmit={(event: SubmitEvent) => { event.preventDefault(); store.saveNames(); }}>
      <textarea value={store.names.value} onInput={(event) => store.setNames(event.currentTarget.value)} onKeyDown={keys} />
      <button type="submit">Save</button>
    </form>
  </dialog>
}
