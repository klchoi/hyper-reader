// The button over a name still missing from the list, or a selection: add it, or add it as
// another name of somebody listed (a relationship: as what they are called). Over a name the list
// has, what its person is: male, female, or living as the other.
import { track } from 'ripple';
import { StoreContext } from './store.ts';
import { GENDERS, genderNames, genderSymbols, namesWithGender } from './marks.ts';
import type { Gender } from './marks.ts';

export function AddName() @{
  const store = StoreContext.get();
  const offer = track(() => store.addName.value);
  // it grows upwards, so every row above the last needs room over the name
  const place = track(() => {
    let at = offer.value;
    let rows = at?.person ? GENDERS.length - 1 + (at.person.gender ? 1 : 0) : at?.aliases.length ?? 0;
    return at ? { top: `${Math.max(at.top, 30 + rows * 24)}px`, left: `${at.left}px` } : {};
  });
  const add = (alias?: string) => {
    let at = offer.value;
    if (at) store.addToNames({ name: at.name, alias, relationship: at.relationship });
  };
  // the tag on the person's line, put there or taken away, and the list saved
  const say = (gender?: Gender) => {
    let person = offer.value?.person;
    let listed = person && namesWithGender(store.names.value, person.name, gender);
    store.showAddName(null);
    getSelection()?.removeAllRanges();
    if (!listed) return;
    store.names.value = listed;
    store.saveNames();
  };

  @if (offer.value?.person) {
    <div id="add-name" style={place.value} onMouseDown={(event: MouseEvent) => event.preventDefault()}>
      @for (const gender of GENDERS) {
        <button
          onClick={() => say(gender)}
          title={`${offer.value?.person?.name} is ${genderNames[gender]}`}
        >{`${offer.value?.person?.gender === gender ? '✓ ' : ''}${genderSymbols[gender]} ${genderNames[gender]}`}</button>
      }
      @if (offer.value?.person?.gender) {
        <button onClick={() => say()} title={`Say nothing of what ${offer.value?.person?.name} is`}>{'× not said'}</button>
      }
    </div>
  } @else {
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
}
