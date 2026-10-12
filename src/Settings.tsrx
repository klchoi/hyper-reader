// The settings, in a panel over the cog at the foot of the rail: the colours, the page's width,
// and the fonts. Put away with the cog, Escape, or a click anywhere else (see listening.ts).
import { StoreContext } from './store.ts';
import { FontPicker } from './FontPicker.tsrx';

const colors = ['white', 'sepia', 'gray', 'night', 'rose-pine', 'rose-pine-moon', 'rose-pine-dawn', 'solarized', 'kiselevka', 'gruvbox'];
const paperSizes = [
  { size: 'sm', label: 'S', title: 'Narrow' },
  { size: 'md', label: 'M', title: 'Medium' },
  { size: 'lg', label: 'L', title: 'Wide' },
  { size: 'xl', label: 'XL', title: 'As wide as the window' },
];

export function Settings() @{
  const store = StoreContext.get();

  <dialog id="settings" open={store.settingsOpen.value} aria-label="Settings">
    <section>
      // a colour is chosen for the light scheme or the dark one, whichever the system is in
      <h2>
        {'Theme'}
        <small class="for-light">{'for light mode'}</small>
        <small class="for-dark">{'for dark mode'}</small>
      </h2>
      <div class="colors">
        @for (const color of colors) {
          <button
            class={[color, { 'checked:light': store.settings.value['color:light'] === color, 'checked:dark': store.settings.value['color:dark'] === color }]}
            onClick={() => store.chooseColor(color)}
            title={`Theme: ${color}`}
          />
        }
      </div>
    </section>
    <section>
      <h2>{'Page width'}</h2>
      <div class="choices">
        @for (const { size, label, title } of paperSizes) {
          <button
            class={{ selected: (store.settings.value.paperSize ?? 'sm') === size }}
            onClick={() => store.saveSettings({ paperSize: size })}
            title={title}
          >{label}</button>
        }
      </div>
    </section>
    <FontPicker />
  </dialog>
}
