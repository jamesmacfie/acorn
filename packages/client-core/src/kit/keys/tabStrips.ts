// Every tab strip on screen, so the command palette can switch tabs without the strip knowing the
// palette exists.
//
// `kit/` may not import the command registry (tools/arch/boundaries.test.ts), so a strip publishes
// itself here and the palette host turns the list into rows (host/palette/tabStripCommands.ts). The
// same split as `revealCollectionItem` in ./collection.ts.

import { createSignal } from 'solid-js'

export type LiveTabStrip = {
  /** Unique per mounted strip, because two task panes can draw strips with the same `idPrefix`. */
  key: number
  label: () => string
  tabs: () => readonly { id: string; label: string }[]
  active: () => string
  select: (id: string) => void
  /** Drawn on screen. A strip in a hidden pane or a hidden tab panel stays mounted and says no. */
  shown: () => boolean
}

const [strips, setStrips] = createSignal<readonly LiveTabStrip[]>([])
let nextKey = 0

export const liveTabStrips = strips

/** Returns the teardown that takes the strip off the list. */
export function publishTabStrip(strip: Omit<LiveTabStrip, 'key'>): () => void {
  const published = { ...strip, key: nextKey++ }
  setStrips((current) => [...current, published])
  return () => setStrips((current) => current.filter((candidate) => candidate !== published))
}
