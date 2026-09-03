// Where the keymap engine asks who has the keys.
//
// `@opentui/keymap` is built from a `KeymapHost`: thirteen members that tell it how to read one
// host's keyboard, tree and focus. The package ships two, an HTML one the desktop uses through
// `client-core/kit/keys/keymapHost.ts` and an OpenTUI one this host used to use whole. Both hosts on
// one engine is how the two adapters cannot drift, and it is why the engine stays
// (docs/tui.md § The adapter).
//
// What was wrong was never the engine but one of its thirteen questions. `getFocusedTarget` returned
// whichever renderable the renderer had focused, so a layer bound to the node the *store* thought had
// the keys did not fire when the *renderer* disagreed — and something had to be a second opinion for
// that sentence to be possible at all. So eleven members are the OpenTUI adapter's, unchanged, and
// two are ours: where the keys are, and when they move (./regions.ts § The one owner).

import { createOpenTuiKeymapHost } from '@opentui/keymap/opentui'
import type { KeymapHost } from '@opentui/keymap'
import type { CliRenderer, KeyEvent, Renderable } from '@opentui/core'
import { focusedRenderable, onFocusMove } from './regions'

/**
 * The host the engine is built from: the renderer's answers to everything except focus.
 *
 * The two overridden members are the whole of this file. Keys still arrive from
 * `renderer.keyInput` — a prepended listener there runs before the renderer routes the key to a
 * renderable, and every ordinary listener does, so nothing about dispatch order changes
 * (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 1).
 */
export function tuiKeymapHost(renderer: CliRenderer): KeymapHost<Renderable, KeyEvent> {
  const base = createOpenTuiKeymapHost(renderer)
  return {
    ...base,
    // `metadata` and `isDestroyed` are getters on the adapter, which the spread above would have
    // frozen to whatever they said at install: the platform never changes but a destroyed renderer
    // reporting itself live is how the engine goes on dispatching into a torn-down tree.
    get metadata() { return base.metadata },
    get isDestroyed() { return base.isDestroyed },
    // The store's answer, and the reason this file exists. Destroyed is nobody: the engine asks this
    // once per key to pick the layers that match, and a layer bound to a corpse must not be one of
    // them. The store's own landing pass is what puts the keys somewhere better, a microtask later.
    getFocusedTarget: () => {
      const node = focusedRenderable()
      return node && !node.isDestroyed ? node : null
    },
    // And telling the engine when they move, which clears a half-pressed sequence and re-draws the
    // footer. The renderer's `focused_renderable` event is not this any more: the store may move the
    // keys without the renderer hearing of it at all (./regions.ts § onFocusMove).
    onFocusChange: (listener) => onFocusMove(listener),
  }
}
