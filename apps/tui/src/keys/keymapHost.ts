// Where the keymap engine asks who has the keys.
//
// `@opentui/keymap` is built from a `KeymapHost`: thirteen members that tell it how to read one
// host's keyboard, tree and focus. The desktop uses the package's HTML one, and this file is the
// terminal's. Both hosts on one engine is how the two adapters cannot drift
// (docs/tui/keys.md § The adapter).
//
// The adapter is ours whole rather than the package's OpenTUI one, because `getFocusedTarget` has to
// answer from the region store: the renderer holds no focus, so there is no second opinion for a
// layer to disagree with (./regions.ts § The one owner).

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
// false and `onTargetDestroy` never fires: Solid's own `onCleanup` is what drops a layer bound to a
// node that left the tree. And `onRawInput` is left out, because there is no raw-input pipe to
// prepend to: bytes reach `../input/parser.ts` and arrive here as events.

const PLATFORM =
  process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32'
      ? 'windows'
      : process.platform === 'linux'
        ? 'linux'
        : 'unknown'

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
  const listen =
    (event: 'keypress' | 'keyrelease') =>
    (listener: (key: KeyEvent) => void): (() => void) => {
      // Prepended for the reason the OpenTUI adapter prepends: dispatch has to have had its say before
      // anything else on the stream reads the key, which is how a binding claims one (./install.ts § typeInto).
      renderer.keyInput.prependListener(event, listener as (...args: unknown[]) => void)
      return () => {
        renderer.keyInput.off(event, listener as (...args: unknown[]) => void)
      }
    }
  return {
    metadata: OWN_METADATA,
    rootTarget: renderer.root,
    get isDestroyed() {
      return renderer.isDestroyed
    },
    getFocusedTarget: () => focusedRenderable(),
    getParentTarget: (target) => target.parent,
    isTargetDestroyed: () => false,
    onKeyPress: listen('keypress'),
    onKeyRelease: listen('keyrelease'),
    onFocusChange: (listener) => onFocusMove(listener),
    onDestroy: (listener) => {
      renderer.once('destroy', listener)
      return () => {
        renderer.off('destroy', listener)
      }
    },
    onTargetDestroy: () => () => {},
    createCommandEvent: () => keyEvent('command') as unknown as KeyEvent,
  }
}
