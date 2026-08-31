// What the keyboard will do right here, as a list of hints.
//
// Textual renders the focused widget's bindings as a footer strip; the cheat sheet is the same data
// with nothing left out. Both read this function, so nothing is declared twice
// (docs/future/terminal/05-keys-and-focus.md § The footer).
//
// The source is the engine's own `getActiveKeys`, which answers for the layers that are active
// against whatever has focus right now — so a hint disappears when the thing that offered it does,
// and a key a rectangle or a trap has taken never shows. `client-core/host/keys/CheatSheet.tsx` reads
// the same call for the same reason.
//
// What this file adds is the words. The engine knows a key is live; it does not know that `j` and `k`
// together are "move", because the intent layers bind anonymous handlers rather than named commands.
// The keys come from the host's own intent table, so a hint can never name a key nothing is bound to.

import type { KeyEvent, Renderable } from '@opentui/core'
import { keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { hostKeysFor } from '../keys/install'
import { focusedRenderable } from '../keys/regions'
import { openOverlays } from './state'

export type Hint = {
  /** The keys as a reader should read them: `j/k`, `enter`, `ctrl+k`. */
  keys: string
  /** What they do, in one word where one will do. */
  label: string
  /** The sentence the cheat sheet adds and the footer has no room for. */
  detail?: string
}

// A hint is shown when its probe key is live. One key rather than all of them, because a hint speaks
// for a pair (`j/k`) or for a synonym set (`enter` and space both activate) and the engine answers
// per key: asking about every one of them would drop "move" the moment `down` was shadowed and `j`
// was not.
type Spec = Hint & { probe: string }

const specs = (): Spec[] => {
  const keys = hostKeysFor()
  const bare = (intent: keyof typeof keys, at = 0): string => keys[intent][at] ?? keys[intent][0] ?? ''
  return [
    { probe: bare('next', 1), keys: 'j/k', label: 'move', detail: 'and the arrows' },
    { probe: bare('activate'), keys: 'enter', label: 'open', detail: 'or space' },
    { probe: bare('expand', 1), keys: 'h/l', label: 'fold', detail: 'and the arrows' },
    { probe: bare('search', 1), keys: '/', label: 'filter' },
    { probe: bare('menu'), keys: 'menu', label: 'menu' },
    { probe: bare('delete'), keys: 'del', label: 'delete' },
    { probe: bare('commit'), keys: keys.commit[0] ?? '', label: 'commit', detail: 'send what is in the box' },
    { probe: bare('nextRegion', 1), keys: 'tab', label: 'region', detail: 'shift+tab goes back; f6 does too' },
    { probe: bare('nextPane'), keys: keys.nextPane[0] ?? '', label: 'pane', detail: 'the pane to the right' },
    { probe: bare('dismiss'), keys: 'esc', label: 'back' },
  ]
}

/**
 * The hints the keyboard offers right now, in reading order.
 *
 * Empty before the keymap is installed, which is every render in a suite that never installed one.
 */
export function activeHints(): Hint[] {
  // The engine has no signal for "the active layers changed", and the two things that change them are
  // both signals here: where the keys are, and whether an overlay has taken them. Read so that a
  // caller drawing this list re-draws when the answer moves — without them the footer is whatever was
  // true at the render that happened to build it.
  focusedRenderable()
  openOverlays()
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return []
  const live = new Set(engine.getActiveKeys().map((key) => engine.formatKey(key.display)))
  const shown = specs().filter((spec) => spec.probe && live.has(engine.formatKey(spec.probe)))
  const hint = ({ probe: _probe, ...rest }: Spec): Hint => rest
  // Every command with a chord and a description of its own — the palette, the cheat sheet, quitting,
  // and whatever a plugin registered. These the engine does know the words for, because a command
  // layer binding carries them (../keys/commandLayer.ts).
  const commands = engine.getActiveKeys({ includeMetadata: true })
    .flatMap((key): Hint[] => {
      const desc = String(key.bindingAttrs?.desc ?? key.commandAttrs?.desc ?? '')
      return desc ? [{ keys: engine.formatKey(key.display), label: desc.toLowerCase() }] : []
    })
  // Move and open first because they are what a reader reaches for; the chords next because they are
  // the ones nobody can guess; the rest after, where the footer's own truncation reaches them first.
  return [...shown.slice(0, 2).map(hint), ...commands, ...shown.slice(2).map(hint)]
}
