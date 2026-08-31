import { createDefaultOpenTuiKeymap } from '@opentui/keymap/opentui'
import { InputRenderable, TextareaRenderable, type CliRenderer } from '@opentui/core'
import { BARE_KEYS, intentKeys } from '@acorn/client-core/kit/keys/keymap.ts'
import { activate, move } from './kit/collection'
import { switchGroup } from './layouts/state'

// The keymap's terminal adapter, which `host/keys/install.ts` names in its own header as the seam it
// does not use yet. This is the day it is used: same package, same layers, same `intentKeys` table,
// a different pair of type parameters.
//
// Layer 40 is the collection tier, exactly as on the desktop (install.ts). Phase 0 registers it
// globally rather than per focused collection, because there is one collection group on screen and
// focus regions without a DOM are phase 2.
export function installKeymap(renderer: CliRenderer, onQuit: () => void): void {
  const engine = createDefaultOpenTuiKeymap(renderer)
  // `super` on macOS, `ctrl` elsewhere, read from the host the way the DOM installer reads it.
  const keys = intentKeys(engine.getHostMetadata().primaryModifier === 'super' ? 'super' : 'ctrl')

  // `j`, `k`, `l`, `h`, space and `q` are letters somebody may be typing. The DOM half asks
  // `isTypingTarget` of the focused element (kit/keys/keymapHost.ts); the same question here is
  // whether the focused renderable is one that takes text. Without it, typing a `q` into the filter
  // field quits.
  const typing = () => {
    const focused = renderer.currentFocusedRenderable
    return focused instanceof InputRenderable || focused instanceof TextareaRenderable
  }
  const bind = (key: string, cmd: () => boolean) =>
    ({ key, cmd, ...(BARE_KEYS.has(key) ? { active: () => !typing() } : {}) })

  engine.registerLayer({
    priority: 40,
    bindings: [
      ...keys.next.map((key) => bind(key, () => move(1))),
      ...keys.prev.map((key) => bind(key, () => move(-1))),
      ...keys.activate.map((key) => bind(key, () => activate())),
      // `expand` and `collapse` are `l` and `h` and the horizontal arrows. Both switch, because a
      // narrow `list-detail` has two halves and no third place to go.
      ...[...keys.expand, ...keys.collapse].map((key) => bind(key, () => switchGroup())),
      // Not an intent: quitting is the shell's, and phase 4 gives it a command and a confirm.
      bind('q', () => { onQuit(); return true }),
    ],
  })
}
