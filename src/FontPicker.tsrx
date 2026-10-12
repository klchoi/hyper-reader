// The fonts and sizes, for the reading and for everything else: the faces this page can name,
// each written in itself, and the size and weight of the one chosen. A part of the settings.
import { track } from 'ripple';
import { cssFontFamily, fontSettings, readingFonts, StoreContext } from './store.ts';
import type { FontTarget } from './store.ts';

const targets: { target: FontTarget; label: string; title: string }[] = [
  { target: 'reading', label: 'Reading', title: 'The font the paragraphs are set in' },
  { target: 'ui', label: 'Interface', title: 'The font everything else is set in' },
];

export function FontPicker() @{
  const store = StoreContext.get();
  // the sliders follow the same toggle the list does
  const picked = track(() => fontSettings[store.fontPicker.value.target]);
  const pickedFont = track(() => store.settings.value[picked.value.family]);
  const pickedSize = track(() => store.settings.value[picked.value.size] || 18);
  const pickedWeight = track(() => store.settings.value[picked.value.weight] || 400);
  const installed = track<string[]>(() => store.settings.value.fonts ?? []);
  const families = track(() => {
    let q = store.fontPicker.value.q.trim().toLowerCase();
    return (installed.value.length > 0 ? installed.value : readingFonts).filter(family => family.toLowerCase().includes(q));
  });
  const slid = (event: Event) => Number((event.currentTarget as HTMLInputElement).value);

  <section class="fonts">
    <h2>{'Font'}</h2>
    <div class="choices">
      @for (const { target, label, title } of targets) {
        <button class={{ selected: store.fontPicker.value.target === target }} onClick={() => store.setFontTarget(target)} title={title}>{label}</button>
      }
    </div>
    <input placeholder="Find a font" value={store.fontPicker.value.q} onInput={(event) => store.setFontQuery(event.currentTarget.value)} />
    @if (installed.value.length > 0) {
      <small>
        {`${installed.value.length} fonts. `}
        <a onClick={() => store.loadFonts(true)}>Look again</a>
      </small>
    } @else {
      <small>These are the fonts this page can name without asking. To pick from everything installed, open it over http://localhost - chrome will not remember the permission for a file:// page.</small>
    }
    <ul>
      <li>
        <button class={{ selected: !pickedFont.value }} onClick={() => store.chooseFont('')}>Default</button>
      </li>
      @for (const family of families.value; key family) {
        <li>
          // the name written in the face itself, which is the only way to tell whether it is one to
          // read a book in
          <button class={{ selected: pickedFont.value === family }} style={{ fontFamily: cssFontFamily(family) }} onClick={() => store.chooseFont(family)}>{family}</button>
        </li>
      }
    </ul>
    <label>
      Size
      <input
        type="range"
        min={10}
        max={32}
        step={0.5}
        value={pickedSize.value}
        onInput={(event: Event) => store.applySettings({ [picked.value.size]: slid(event) })}
        onChange={(event: Event) => store.saveSettings({ [picked.value.size]: slid(event) })}
      />
      <span>{`${pickedSize.value}pt`}</span>
    </label>
    <label>
      Weight
      <input
        type="range"
        min={100}
        max={900}
        step={100}
        value={pickedWeight.value}
        onInput={(event: Event) => store.applySettings({ [picked.value.weight]: slid(event) })}
        onChange={(event: Event) => store.saveSettings({ [picked.value.weight]: slid(event) })}
      />
      <span>{pickedWeight.value}</span>
    </label>
  </section>
}
