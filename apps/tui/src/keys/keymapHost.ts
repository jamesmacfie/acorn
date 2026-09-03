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
import type { HostMetadata, KeymapHost } from '@opentui/keymap'
import type { CliRenderer, KeyEvent, Renderable } from '@opentui/core'
import { drawsOwn } from '../painter'
import { ownKeyEvent } from '../ownKeys'
import type { OwnRenderer } from '../ownRenderer'
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
  // The new painter's tree is not OpenTUI's, so it gets the adapter written for it below rather than
  // eleven of somebody else's answers about a renderer it does not have.
  if (drawsOwn()) return ownKeymapHost(renderer as unknown as OwnRenderer)
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

// ── The same thirteen questions, over our own tree ────────────────────────────────────────────
//
// The engine is host-agnostic and the adapter is the whole of what it knows about a host, so a second
// painter needs a second adapter and not a second keymap. This one answers over `../ownRenderer.ts`
// and `../tree/node.ts`: the tree walk is `parent`, the key stream is an emitter a caller pushes a
// `KeyEvent` onto, and focus is the store's, which it already was.
//
// Three answers are shorter here than they are over OpenTUI, and each is an absence rather than a
// stub. A node is never destroyed, so `isTargetDestroyed` is false and `onTargetDestroy` never fires
// — Solid's own `onCleanup` is what drops a layer bound to a node that left the tree. And there is no
// raw-input pipe to prepend to: bytes reach `../input/parser.ts` and arrive here as events.
//
// Phase 4 keeps this half and deletes the other one.

const PLATFORM = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows'
    : process.platform === 'linux' ? 'linux' : 'unknown'

/** What the engine is told about the keyboard it is reading. The same answers OpenTUI's adapter gives
 *  for the same host, kitty included, because `../input/terminal.ts` asks for the protocol
 *  (@opentui/keymap § createOpenTuiHostMetadata). */
const OWN_METADATA: HostMetadata = {
  platform: PLATFORM,
  primaryModifier: PLATFORM === 'macos' ? 'super' : PLATFORM === 'unknown' ? 'unknown' : 'ctrl',
  modifiers: {
    ctrl: 'supported',
    shift: 'supported',
    meta: 'supported',
    super: 'supported',
    hyper: 'supported',
  },
}

function ownKeymapHost(renderer: OwnRenderer): KeymapHost<Renderable, KeyEvent> {
  const listen = (event: 'keypress' | 'keyrelease') => (listener: (key: KeyEvent) => void): (() => void) => {
    // Prepended for the reason the OpenTUI adapter prepends: dispatch has to have had its say before
    // anything else on the stream reads the key, which is how a binding claims one (§ typeInto).
    renderer.keyInput.prependListener(event, listener as (...args: unknown[]) => void)
    return () => { renderer.keyInput.off(event, listener as (...args: unknown[]) => void) }
  }
  return {
    metadata: OWN_METADATA,
    rootTarget: renderer.root as unknown as Renderable,
    get isDestroyed() { return renderer.isDestroyed },
    getFocusedTarget: () => focusedRenderable(),
    getParentTarget: (target) => target.parent,
    isTargetDestroyed: () => false,
    onKeyPress: listen('keypress'),
    onKeyRelease: listen('keyrelease'),
    onFocusChange: (listener) => onFocusMove(listener),
    onDestroy: (listener) => {
      renderer.once('destroy', listener)
      return () => { renderer.off('destroy', listener) }
    },
    onTargetDestroy: () => () => {},
    createCommandEvent: () => ownKeyEvent('command') as unknown as KeyEvent,
  }
}
