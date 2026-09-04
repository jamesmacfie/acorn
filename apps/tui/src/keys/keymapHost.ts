// Where the keymap engine asks who has the keys.
//
// `@opentui/keymap` is built from a `KeymapHost`: thirteen members that tell it how to read one
// host's keyboard, tree and focus. The package ships an HTML one the desktop uses through
// `client-core/kit/keys/keymapHost.ts`, and this file is the terminal's. Both hosts on one engine is
// how the two adapters cannot drift, and it is why the engine stays (docs/tui.md § The adapter).
//
// This host used to build its adapter from the OpenTUI one the package ships, overriding two of the
// thirteen. What was wrong was never the engine but one of its questions: `getFocusedTarget`
// returned whichever renderable the renderer had focused, so a layer bound to the node the *store*
// thought had the keys did not fire when the *renderer* disagreed — and something had to be a second
// opinion for that sentence to be possible at all. There is no renderer holding focus now, so the
// adapter is ours whole and the question has one answer (./regions.ts § The one owner).

import type { HostMetadata, KeymapHost } from '@opentui/keymap'
import type { Renderable } from '../tree/compat'
import type { Renderer } from '../renderer'
import { keyEvent, type KeyEvent } from '../keyEvent'
import { focusedRenderable, onFocusMove } from './regions'

// ── The thirteen questions, over our own tree ─────────────────────────────────────────────────
//
// The engine is host-agnostic and the adapter is the whole of what it knows about a host, so this is
// the whole of what the keymap knows about this painter. It answers over `../renderer.ts` and
// `../tree/node.ts`: the tree walk is `parent`, the key stream is an emitter a caller pushes a
// `KeyEvent` onto, and focus is the store's.
//
// Three answers are absences rather than stubs. A node is never destroyed, so `isTargetDestroyed` is
// false and `onTargetDestroy` never fires — Solid's own `onCleanup` is what drops a layer bound to a
// node that left the tree. And there is no raw-input pipe to prepend to: bytes reach
// `../input/parser.ts` and arrive here as events.

const PLATFORM = process.platform === 'darwin' ? 'macos'
  : process.platform === 'win32' ? 'windows'
    : process.platform === 'linux' ? 'linux' : 'unknown'

/** What the engine is told about the keyboard it is reading. The same answers OpenTUI's adapter gives
 *  for the same host, kitty included, because `../input/terminal.ts` asks for the protocol in its
 *  enter sequence. */
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

export function tuiKeymapHost(renderer: Renderer): KeymapHost<Renderable, KeyEvent> {
  const listen = (event: 'keypress' | 'keyrelease') => (listener: (key: KeyEvent) => void): (() => void) => {
    // Prepended for the reason the OpenTUI adapter prepends: dispatch has to have had its say before
    // anything else on the stream reads the key, which is how a binding claims one (§ typeInto).
    renderer.keyInput.prependListener(event, listener as (...args: unknown[]) => void)
    return () => { renderer.keyInput.off(event, listener as (...args: unknown[]) => void) }
  }
  return {
    metadata: OWN_METADATA,
    rootTarget: renderer.root,
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
    createCommandEvent: () => keyEvent('command') as unknown as KeyEvent,
  }
}
