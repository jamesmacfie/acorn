import type { Accessor } from 'solid-js'
import type { Renderable } from '@opentui/core'
import { layoutState } from '@acorn/client-core/host/layouts/state.ts'
import { bindKeys } from '../keys/install'

// A split that moves by a key, because a terminal has no grip to drag.
//
// Three layouts have one — `list-detail`, `stack-split` and the two document splits — and all three
// keep the position in the same host-owned session signal the DOM layouts use
// (client-core/host/layouts/state.ts), so a pane that unmounts and comes back finds its posture where
// it left it on either host. `SplitHandle` and `SplitCell` are `absent` in the support matrix for
// exactly this reason: the handle is a key, not a node (docs/future/terminal/04-rendering.md).
//
// The chord is the platform's primary modifier with shift and an arrow, on layer 30, focus-within on
// the layout's own box. Layer 30 is a pane's own tier and shift keeps it clear of the pane-cycling
// chords at layer 5.

/** How many cells or lines one press moves the split. Two, so a press is visible without being a
 *  jump: a terminal's units are big enough that one would read as a stutter. */
const STEP = 2

export type Split = {
  size: Accessor<number>
  /** Called from the layout box's `ref`. */
  attach: (box: Renderable) => void
}

export function createKeySplit(options: {
  stateKey: string
  /** The name under the pane id, so two splits in one pane do not share a number. */
  name: string
  axis: 'x' | 'y'
  initial: number
  min: number
  /** The layout's own box, never the terminal: nothing in a layout reads the screen's size. */
  ceiling: () => number
}): Split {
  const [size, setSize] = layoutState(options.stateKey, options.name, options.initial)
  const nudge = (delta: number): boolean => {
    const next = Math.min(Math.max(size() + delta, options.min), Math.max(options.min, options.ceiling()))
    if (next === size()) return false
    setSize(next)
    return true
  }
  const [less, more] = options.axis === 'x' ? ['left', 'right'] : ['up', 'down']
  return {
    size,
    attach: (box) => bindKeys(box, [
      { key: `super+shift+${less}`, cmd: () => nudge(-STEP) },
      { key: `super+shift+${more}`, cmd: () => nudge(STEP) },
      { key: `ctrl+shift+${less}`, cmd: () => nudge(-STEP) },
      { key: `ctrl+shift+${more}`, cmd: () => nudge(STEP) },
    ], 30),
  }
}
