// Collections in cells: the terminal half of `client-core/kit/keys/collection.ts`.
//
// The list rules — what wraps, where the first press lands, which of select and activate picks, what
// the page keys move by — are `collectionIntents.ts` and are shared, so the two hosts cannot drift
// (docs/tui.md § Collections). This file supplies the two things the
// DOM half supplies with elements:
//
//   land    put focus on the item. There is no element, so a row hands its renderable back as it
//           draws and the renderer focuses that. A virtualised row outside the drawn window has
//           none, which is `Grid`'s documented exception made general: `active` moves anyway and the
//           window follows it, because in a terminal there is no pointer to scroll with.
//   onItem  whether the item itself holds focus rather than a control inside it. Always true here: a
//           cell row holds no stop of its own, so there is nothing else Enter could belong to.
//
// Phase 0's stand-in was one store for every list on screen and no focus at all. This is one
// collection per `Rows`, keyed by the collection's own id, which is what the host store has always
// been keyed by (client-core/kit/keys/collectionState.ts).

import { createEffect, onCleanup } from 'solid-js'
import type { Renderable } from '@opentui/core'
import { _resetCollectionState } from '@acorn/client-core/kit/keys/collectionState.ts'
import {
  COLLECTION_INTENTS, createCollectionIntents, type CollectionIntentOptions, type CollectionItem,
} from '@acorn/client-core/kit/keys/collectionIntents.ts'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import {
  activationEntersMain, claimIfProvisional, focusedRenderable, markItem, moveColumn, noteFocus,
  replaceFocusable,
} from './regions'

/**
 * What one item of a collection is handed.
 *
 * Opaque to the caller, as on the DOM: a pane spreads it onto the item's own node and never inspects
 * it. The DOM's carries an id, a role and a roving `tabindex`; this one carries the two things a cell
 * row needs — whether it is the roving stop, and where it drew — plus the press, because a DOM `Row`
 * is a button and Enter on it raises a click by itself while a cell row has to hand its handler over.
 */
export type ItemProps = {
  readonly key: string
  readonly active: () => boolean
  readonly ref: (box: Renderable) => void
  readonly press: (run: () => void) => void
}

export type CellCollectionOptions = Omit<CollectionIntentOptions, 'land' | 'onItem'>

export type CellCollection = {
  active: () => string | null
  selected: () => string | null
  itemProps: (key: string) => ItemProps
  /** The layer the collection's container registers. Called from the container's `ref`. */
  attach: (box: Renderable) => void
  /** Restore renderer focus after a virtual mouse window brings the active row back on screen. */
  focusActive: () => boolean
}

export function createCellCollection(options: CellCollectionOptions): CellCollection {
  const boxes = new Map<string, Renderable>()
  const presses = new Map<string, () => void>()

  const keys = createCollectionIntents({
    ...options,
    land: (key) => {
      const box = boxes.get(key)
      if (!box) return
      box.focus()
      // The region the row is in now has the keys, which is what `focusin` says on the DOM. The
      // retained renderable tree is the bubble here.
      noteFocus(box)
    },
    onItem: () => true,
    onActivate: (key) => {
      // Capture this before activation. A rail row can replace the source/task surface, but Enter
      // still means "open this row, then work in what opened" rather than merely moving focus.
      const enterMain = activationEntersMain()
      options.onActivate?.(key)
      presses.get(key)?.()
      if (enterMain) moveColumn(1)
    },
  })

  return {
    active: keys.active,
    selected: keys.selected,
    itemProps: (key) => ({
      key,
      // The caret is where the keys are, not merely where the store's roving stop sits: three lists
      // are drawn side by side in one pane and only one of them has focus, so drawing `active` alone
      // would paint a caret in each. `active` decides *which* row of this collection would take the
      // keys; focus decides whether this collection has them.
      active: () => keys.active() === key && focusedRenderable() === boxes.get(key),
      ref: (box) => {
        const previous = boxes.get(key)
        boxes.set(key, box)
        // A row, so a region opening on this pane lands on the list rather than on the filter above
        // it (./regions.ts § firstStop).
        // Browse opts into picking when its region is entered. Hand it the collection's ordinary
        // move rather than a second selection path, so select-on-move remains the one rule.
        markItem(box, () => keys.goTo(key), `${options.id()}\u0000${key}`)
        // Solid keys rows by their data-object reference, while collection state keys them by this
        // logical key. A refresh may therefore redraw the same row as a new renderable. Advance live
        // focus only when this collection replaced its own row; the region-wide identity registry
        // remains responsible for restoring the logical item when a whole collection remounts.
        replaceFocusable(previous, box)
        onCleanup(() => { if (boxes.get(key) === box) boxes.delete(key) })
      },
      press: (run) => {
        presses.set(key, run)
        onCleanup(() => { if (presses.get(key) === run) presses.delete(key) })
      },
    }),
    focusActive: () => {
      const key = keys.active()
      const box = key ? boxes.get(key) : undefined
      if (!box) return false
      box.focus()
      noteFocus(box)
      return true
    },
    attach: (box) => {
      // Layer 40, focus-within on the collection, exactly as on the desktop (client-core
      // host/keys/install.ts § the four tiers). Priority decides, not locality.
      onCleanup(registerIntentLayer(box, COLLECTION_INTENTS, keys.handle))
      // A region's contents are `lazy` and its rows come from a query, so a pane opens before its list
      // exists and the region lands the keys on its own box for want of anything better. This is the
      // list arriving and taking them off it (./regions.ts § claimIfProvisional).
      //
      // An effect on the items rather than a one-shot, because "the list exists" happens when the
      // response does, which is several frames after the container. It re-runs when the list is
      // rebuilt and claims nothing once something real has the keys, so a second list on the same
      // screen does not steal them. The microtask is because the rows are mounted by the render that
      // gave us the container.
      createEffect(() => {
        if (!options.items().length) return
        queueMicrotask(() => {
          const key = keys.active()
          if (!key) return
          const box = boxes.get(key)
          if (!box) return
          // …and this is the other thing that effect has to catch: the rebuild took the keys with it.
          // `Rows` draws through `<For>`, which is keyed by reference, and a pane's items are a fresh
          // array on every render — so any refetch destroys the row focus was on, the renderer's focus
          // goes with it, and on a host with no pointer there is no way to put it back. Re-land on the
          // same key, which is the row the reader was on.
          const holder = focusedRenderable()
          if (holder?.isDestroyed) {
            box.focus()
            noteFocus(box)
            return
          }
          claimIfProvisional(box)
        })
      })
    },
  }
}

export type { CollectionItem }

/** Test seam: the host store outlives a single render, so a suite must not inherit a caret. */
export function _resetCollections(): void {
  _resetCollectionState()
}
