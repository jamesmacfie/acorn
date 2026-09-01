// The keymap, installed once on the renderer.
//
// `client-core/host/keys/install.ts` names this file's seam in its own header: "its terminal adapter,
// which we do not use yet, is in the same package". This is the day it is used. Same engine, same
// `intentKeys` table, same four tiers ordered by priority, a different pair of type parameters:
// `Keymap<Renderable, KeyEvent>` where the DOM's is `Keymap<HTMLElement, HtmlKeymapEvent>`.
//
//   0   the command layer: acorn's resolved keybindings over the command registry, the same tier the
//       desktop puts them on (./commandLayer.ts)
//   5   region, pane and column movement, global, because moving between them starts anywhere
//   30  a pane's own layer: the `tabs` layout's chords, and the group switch a narrow `list-detail`
//       registers
//   40  a collection's intents, focus-within on the collection (./collection.ts)
//   45  a `Sections` strip, which yields left/right at its edges (../kit/grouping.tsx)
//
// A binding whose handler returns false is not handled, so dispatch carries on to the next layer.
// That is how an intent bubbles: the focused collection answers it, or the region layer does, or
// nothing does.

import { onCleanup } from 'solid-js'
import { createDefaultOpenTuiKeymap } from '@opentui/keymap/opentui'
import { InputRenderable, TextareaRenderable, type CliRenderer, type KeyEvent, type Renderable } from '@opentui/core'
import type { Keymap, TargetMode } from '@opentui/keymap'
import { isTyping, keymap, keysFor, setKeymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import { BARE_KEYS } from '@acorn/client-core/kit/keys/keymap.ts'
import { moveBack, moveColumn, moveRegion, movePane } from './regions'

export type TuiKeymap = Keymap<Renderable, KeyEvent>

// The one intent this host spells with a key the desktop cannot spare.
//
// Tab is the browser's own focus order, so the DOM host reaches "the next region of this window" with
// F6, which is the platform convention and not a chord anything else claims. A terminal has no focus
// order to inherit and no other claim on Tab, and a reader in one presses Tab first — so on this host
// the intent has two keys rather than one.
//
// The intent is the shared one and the table is still `intentKeys`. This is a host adding a key to an
// intent it already has, which is what a per-host key table is for; a key that meant something a
// desktop intent does not would be a second keymap, and that is refused
// (docs/tui.md § What must never happen).
const HOST_KEYS: Partial<Record<Intent, readonly string[]>> = {
  nextRegion: ['tab'],
  prevRegion: ['shift+tab'],
}

/** The intent-to-key table for this host: the shared one, plus what the terminal adds. Read by the
 *  region layer below and by the footer, so a hint cannot name a key nothing is bound to. */
export function hostKeysFor(): Record<Intent, readonly string[]> {
  const map = keysFor()
  const merged = { ...map } as Record<Intent, readonly string[]>
  for (const [intent, keys] of Object.entries(HOST_KEYS)) {
    merged[intent as Intent] = [...map[intent as Intent], ...keys]
  }
  return merged
}

/**
 * Install the keymap on the renderer and register the region chords.
 *
 * Returns the engine, because the composition root has one layer of its own to add — quitting, which
 * is the shell's and not an intent. Everything else reaches it through the singleton. The teardown is
 * the caller's, which on this host is the process ending.
 */
export function installKeymap(renderer: CliRenderer): TuiKeymap {
  const engine = createDefaultOpenTuiKeymap(renderer)

  // `j`, `k`, `l`, `h`, space and `/` are letters somebody may be typing. The DOM half asks
  // `isTypingTarget` of the focused element; the same question here is whether the focused renderable
  // is one that takes text. Without it, typing a `j` into the filter field walks the list instead.
  //
  // An entered PTY is the other typing target, and a stricter one: every key is its input, chords
  // included, until Escape. That one does not go through this predicate — the rectangle takes the
  // keys before dispatch instead, because a predicate can only hold off the bindings that ask
  // (../kit/rectangle.tsx § The Rectangle contract).
  setKeymap(engine, {
    // Ctrl, whatever platform this is. The engine reports the *platform's* primary modifier and on
    // macOS that is Cmd, which a terminal emulator keeps for itself and never delivers — so Cmd+Return
    // would be a chord nobody can press. Every chord in the intent table is spelled with Ctrl here,
    // and so is every chord the shell registers.
    primary: 'ctrl',
    typing: () => {
      const focused = renderer.currentFocusedRenderable
      return !!focused && (focused instanceof InputRenderable || focused instanceof TextareaRenderable)
    },
  })

  // Per-binding gating, the same field the DOM installer registers: `registerEnabledFields` only
  // reaches layers and commands, and a bare key's "not while somebody is typing" is a property of one
  // binding. Without this the engine ignores `active` and a `j` in a filter field walks the list.
  engine.registerBindingFields({
    active(value, ctx) { ctx.activeWhen(value as () => boolean) },
  })

  // Region and pane chords. Global, because they are how you get back to a region you can no longer
  // see, and typing-exempt because they have to work from inside a composer.
  const map = hostKeysFor()
  const moves: [Intent, () => boolean][] = [
    ['nextRegion', () => moveRegion(1)],
    ['prevRegion', () => moveRegion(-1)],
    ['nextPane', () => movePane(1)],
    ['prevPane', () => movePane(-1)],
    // An overlay's dismiss layer and an entered PTY sit above this one. With neither active, Escape
    // from main is the terse spelling of the same spatial edge as Ctrl+Option+Left; from the rail it
    // returns false so the shell can still dismiss a notification.
    ['dismiss', moveBack],
  ]
  const columnMoves: [Intent, () => boolean][] = [
    ['expand', () => moveColumn(1)],
    ['collapse', () => moveColumn(-1)],
  ]
  engine.registerLayer({
    priority: 5,
    bindings: [
      ...moves.flatMap(([intent, run]) => map[intent].map((key) => ({ key, cmd: run }))),
      ...columnMoves.flatMap(([intent, run]) => map[intent].map((key) => ({
        key,
        cmd: run,
        // Left and right inside a field move its cursor. Unlike the region and pane chords, spatial
        // movement is therefore inactive for every typing target, including arrow-key spellings.
        active: () => !isTyping(),
      }))),
    ],
  })

  return engine
}

/**
 * A layer bound to one renderable, for the layouts and the traps.
 *
 * The same shape `bindIntents` gives a kit node, minus the `onMount` deferral: the DOM keymap refuses
 * a target that is not in the document and OpenTUI has no such rule, so a ref can register directly.
 */
export function bindKeys(
  target: Renderable,
  bindings: readonly { key: string; cmd: () => boolean }[],
  priority: number,
  /** `whileTyping` lifts the bare-key gate for these bindings. One caller: a suggestions list under an
   *  edit buffer, where the field itself is the typing target and `↓` has nothing else it could mean
   *  (../kit/asking.tsx § MentionTextarea). */
  options: { mode?: TargetMode; whileTyping?: boolean } = {},
): void {
  // Read through the singleton rather than threaded, so a layout or a modal deep in a tree can bind
  // without every component above it carrying the engine.
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return
  onCleanup(engine.registerLayer({
    target,
    targetMode: options.mode ?? 'focus-within',
    priority,
    bindings: bindings.map(({ key, cmd }) => ({
      key,
      cmd,
      ...(BARE_KEYS.has(key) && !options.whileTyping ? { active: () => !isTyping() } : {}),
    })),
  }))
}
