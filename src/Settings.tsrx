// The settings down the other side: back to the library, the colours, the page's width, the
// fonts, and for the book open, reading it again, zen, and its names.
import { StoreContext } from './store.ts';

const colors = ['white', 'sepia', 'gray', 'night', 'rose-pine', 'rose-pine-moon', 'rose-pine-dawn', 'solarized', 'kiselevka', 'gruvbox'];
const paperSizes = ['sm', 'md', 'lg', 'xl'];

export function Settings() @{
  const store = StoreContext.get();

  <aside class="settings">
    @if (store.chapter.value) {
      <div>
        <a
          class="close"
          href={store.router.route({})}
          onClick={(event: MouseEvent) => { event.preventDefault(); store.showLibrary(); }}
          title="Back to bookshelf"
        />
      </div>
    }
    <div class="colors">
      @for (const color of colors) {
        <button
          class={[color, { 'checked:light': store.settings.value['color:light'] === color, 'checked:dark': store.settings.value['color:dark'] === color }]}
          onClick={() => store.chooseColor(color)}
          title={`Theme: ${color}`}
        />
      }
    </div>
    <div class="paper-size">
      @for (const size of paperSizes) {
        <button
          class={['size', size, { selected: store.settings.value.paperSize === size }]}
          onClick={() => store.saveSettings({ paperSize: size })}
          title={`Page size: ${size}`}
        >{size}</button>
      }
    </div>
    <div>
      <button class="font" onClick={() => store.toggleFontPicker(true)} title="Fonts and sizes" />
    </div>
    @if (store.chapter.value) {
      <div>
        <button class="refresh" onClick={() => store.refreshBook()} title="Refresh book" />
        <button class="zen" onClick={() => store.saveSettings({ zen: !store.settings.value.zen })} title="Toggle Zen Mode" />
        <button class="names-editor" onClick={() => store.toggleNamesEditor(true)} title="Edit names" />
      </div>
    }
  </aside>
}
