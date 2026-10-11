// The button over a name still missing from the list, or a selection: add it, or add it as
// another name of somebody listed (a relationship: as what they are called).
import { track } from 'ripple';
import { StoreContext } from './store.ts';

export function AddName() @{
  const store = StoreContext.get();
  const offer = track(() => store.addName.value);
  // it grows upwards, so every row above the last needs room over the name
  const place = track(() => {
    let at = offer.value;
    return at ? { top: `${Math.max(at.top, 30 + at.aliases.length * 24)}px`, left: `${at.left}px` } : {};
  });
  const add = (alias?: string) => {
    let at = offer.value;
    if (at) store.addToNames({ name: at.name, alias, relationship: at.relationship });
  };

  @if (offer.value) {
    <div id="add-name" style={place.value} onMouseDown={(event: MouseEvent) => event.preventDefault()}>
      // a name made of words of a name already listed is most likely that person under another
      // name, so they are offered before a new entry. A relationship is nobody's name, so the rows
      // are who it is said of
      @for (const canonical of offer.value.aliases) {
        <button
          onClick={() => add(canonical)}
          title={offer.value?.relationship ? `Add ${offer.value.name} as what ${canonical} is called` : `Add ${offer.value?.name} as another name of ${canonical}`}
        >{`+ ${canonical}`}</button>
      }
      // shown the way it is stored, so the parens are no surprise later
      <button onClick={() => add()} title="Add to names list">{offer.value.relationship ? `+ (${offer.value.name.toLowerCase()})` : `+ ${offer.value.name}`}</button>
    </div>
  }
}
