import { onCleanup } from 'solid-js'

// Which half of a narrow `list-detail` has the keys, as something the keymap can reach.
//
// The projection says the split "moves by a key, not a drag" (docs/panes.md § Layout model), and a
// layout may not handle a key — the keymap owns every key on both hosts. So the layout registers what
// it can do and `../keys.ts` binds an intent to it, the same shape `../kit/collection.ts` uses for a
// list. A layout that is not narrow registers a switch that refuses, so the intent bubbles to whatever
// else wants it.
//
// One switch at a time, because phase 0 draws one pane. Phase 4 has a pane row and this becomes the
// focused pane's.
let current: (() => boolean) | null = null

export function registerGroupSwitch(toggle: () => boolean): void {
  current = toggle
  onCleanup(() => { if (current === toggle) current = null })
}

export const switchGroup = (): boolean => current?.() ?? false
