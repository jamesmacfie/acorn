// A control as a stop, in cells.
//
// `focusRoles.ts` says which kit nodes are a stop; this is what a stop *is* on this host. The DOM
// gets three of the four things for free — a `<button>` is focusable, draws a ring, and raises a
// click on Enter and Space — and a cell renderable gets none of them, so each has to be said:
//
//   focusable   the renderer's own flag, the same one a `Row` sets (./collection.ts)
//   the keys    one layer bound to the exact renderable, so Enter on a button inside a row belongs
//               to the button and Enter on the row belongs to the row
//   the press   the handler the prop already carried and nobody called
//   the mark    `focused()`, which the node draws with `litControl` (../kit/roles.ts)
//
// Nothing here decides which node is a stop and nothing here draws. The node asks for a press and is
// told whether it has the keys (docs/tui.md § Rendering).

import { createEffect, createSignal, onCleanup } from 'solid-js'
import type { Renderable } from '@opentui/core'
import { registerIntentLayer } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import { focusedRenderable, moveStop, scheduleSettle } from './regions'
import { STOP } from './tiers'

export type StopOptions = {
  /** What `activate` runs. Absent leaves Enter to bubble, which a chip that can only be removed wants. */
  onPress?: () => void
  /** A disabled control is not focusable and does not press: `↓` and region entry skip it, which is
   *  what a `disabled` attribute does on the DOM. */
  disabled?: () => boolean
  /** The other intents this stop answers, each saying whether it took the intent. `Chip`'s `delete`
   *  and `SegmentedControl`'s whole collection come through here. */
  on?: Partial<Record<Intent, () => boolean>>
  /** This stop opens a list rather than doing something. The footer says `enter open` instead of
   *  `enter press`, which is the only difference it makes (../chrome/bindings.ts). */
  opens?: boolean
}

// Which stops open a list. A `Menu` trigger and therefore every `Select`, and nothing else so far.
// A WeakSet rather than a prop on the node, for the same reason `items` is one: the footer asks
// about whatever has the keys and must not need to know which kit node drew it.
const opening = new WeakSet<Renderable>()

/** Whether the stop that has the keys opens a list. */
export const focusedOpens = (): boolean => {
  const node = focusedRenderable()
  return !!node && opening.has(node)
}

// Which stops answer `expand` and `collapse` themselves. `DocumentTabs`, `SegmentedControl` and a
// chip row are each a horizontal collection drawn as one stop, so Left and Right move inside them
// rather than crossing a column — and the footer has to say `move` there rather than `column`, or it
// names a key that does something else (../chrome/bindings.ts § the cross word).
const crossing = new WeakSet<Renderable>()

/** Whether the stop that has the keys answers the horizontal pair itself. */
export const focusedCrosses = (): boolean => {
  const node = focusedRenderable()
  return !!node && crossing.has(node)
}

/** Make a renderable a stop: focusable, pressed by `activate`, and pressed by the mouse. */
export function pressable(box: Renderable, options: StopOptions): void {
  const off = () => options.disabled?.() ?? false
  if (options.opens) opening.add(box)
  if (options.on?.expand || options.on?.collapse) crossing.add(box)
  createEffect(() => {
    if (!off()) { box.focusable = true; return }
    // Blurred before the flag goes. `blur()` refuses a node that is not focusable, so clearing the
    // flag first would leave a control that was holding the keys holding them for the rest of the
    // run, and every box above it reporting a focused descendant with it
    // (@opentui/core § Renderable.blur).
    //
    // And then the keys are nowhere, which nothing else on this turn would notice: a blur is not a
    // commit and a screen with one region cannot Tab out of it. So the landing rule gets a turn
    // (./regions.ts § The landing rule).
    if (box.focused) {
      box.blur()
      scheduleSettle()
    }
    box.focusable = false
  })
  const given = options.on ?? {}
  const runs: Partial<Record<Intent, () => boolean>> = {
    ...(options.onPress ? { activate: () => { options.onPress!(); return true } } : {}),
    ...given,
    // Every stop moves to the next one beside it, after whatever the node wanted the arrows for.
    // `SegmentedControl` is a whole collection reached through `on` and answers them itself; a node
    // that declines gets the walk.
    //
    // At the stop's own priority rather than at the collection tier below it, which the design asked
    // for. `moveStop` returns false for anything it does not own, so a `Button` drawn inside a `Row`
    // hands the arrows straight back to the list. A second layer one number lower would buy the same
    // answer and one more layer per control on screen.
    next: () => given.next?.() || moveStop(1),
    prev: () => given.prev?.() || moveStop(-1),
  }
  onCleanup(registerIntentLayer(box, Object.keys(runs) as Intent[], (intent) => {
    if (off()) return false
    return runs[intent]?.() ?? false
  }, { priority: STOP, mode: 'focus' }))
  // Click to focus and then press, which is the whole of this host's pointer model
  // (docs/tui.md § What the TUI never does). Only the press is here: the renderer focuses the
  // nearest focusable ancestor of a left mouse-down itself and the store reads that off the same
  // event a key move raises, so a click needs no bridge (../keys/regions.ts § The one writer).
  box.onMouseDown = () => {
    if (off()) return
    options.onPress?.()
  }
}

/**
 * `pressable` plus the two things a component drawing itself needs: the `ref` to hand its box, and
 * whether it has the keys.
 *
 * A `ref` callback cannot return a signal, so the accessor is this helper's rather than
 * `pressable`'s. Every node in the kit uses this one; `pressable` is for a caller that already holds
 * its renderable.
 */
export function stop(options: StopOptions): { ref: (box: Renderable) => void; focused: () => boolean } {
  const [box, setBox] = createSignal<Renderable>()
  return {
    ref: (element: Renderable) => {
      setBox(element)
      pressable(element, options)
    },
    focused: () => {
      const element = box()
      return !!element && focusedRenderable() === element
    },
  }
}
