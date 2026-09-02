// The keymap, installed once on the renderer.
//
// `client-core/host/keys/install.ts` names this file's seam in its own header: "its terminal adapter,
// which we do not use yet, is in the same package". This is the day it is used. Same engine, same
// `intentKeys` table, the same tiers ordered by priority, a different pair of type parameters:
// `Keymap<Renderable, KeyEvent>` where the DOM's is `Keymap<HTMLElement, HtmlKeymapEvent>`.
//
// The tiers and the sentence for each are in ./tiers.ts, which is the one file in this package that
// spells a priority. This one registers the `REGION` tier: region, pane and column movement, global,
// because moving between them starts anywhere.
//
// A binding whose handler returns false is not handled, so dispatch carries on to the next layer.
// That is how an intent bubbles: the focused collection answers it, or the region layer does, or
// nothing does. Which is also why a handler that changed nothing must say so
// (docs/tui.md § The five key groups).

import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { onCleanup } from 'solid-js'
import { createDefaultOpenTuiKeymap } from '@opentui/keymap/opentui'
import { InputRenderable, TextareaRenderable, type CliRenderer, type KeyEvent, type Renderable } from '@opentui/core'
import type { Keymap, TargetMode } from '@opentui/keymap'
import { isTyping, keymap, keysFor, setKeymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import { BARE_KEYS } from '@acorn/client-core/kit/keys/keymap.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import {
  focusedRegion, focusedRenderable, installRegions, moveBack, moveColumn, moveRegion, movePane,
  scopeDepth,
} from './regions'
import { REGION } from './tiers'

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

// ── The trace ─────────────────────────────────────────────────────────────────────────────────
//
// One line per key, behind `ACORN_TUI_KEYS_TRACE`, because "the keys stopped working" is a report
// nobody can act on and this turns it into a log (docs/tui.md § Keys and focus).
//
// A `key:after` intercept rather than a layer: it runs once per key after dispatch has finished, so
// it can say what answered and why without claiming the key. The hyphenated `key-after` is not a
// hook name and registers nothing, silently. Registered without `release`, which is how the engine
// spells "presses only" — with it, every keystroke would log twice.

/**
 * Clear whatever transient feedback is on screen, and say whether there was any.
 *
 * The first step of `dismiss`, so Escape means "get this out of my way" before it means anything to a
 * pane. It reads the toast store rather than asking the shell, because `keys/` may not import
 * `chrome/` (tools/arch/boundaries.test.ts § the terminal focus store knows the keyboard and not the
 * screen) and because the store is where the answer is: a toast is not focusable and has nowhere to
 * hold a layer of its own, so the shell only ever drew it (../chrome/Notifications.tsx).
 *
 * It was a second layer at this tier, registered by the shell's root box. Two layers at one priority
 * fall back to the order they registered in, which is the reconciler's business and not a rule
 * anybody wrote down, so which Escape a reader got was luck
 * (./tiers.ts).
 */
const clearNotifications = (): boolean => {
  const open = activeToasts()
  for (const entry of open) dismissToast(entry.id)
  return open.length > 0
}

/** Where the log goes. The XDG state directory, which is for data a program keeps across runs and
 *  can regenerate — exactly what a key log is. Not `configDir()`, which is `../node/paths.ts` and is
 *  node-side; this folder may not reach it. */
const logPath = (): string => {
  const state = process.env.XDG_STATE_HOME || join(homedir(), '.local', 'state')
  return join(state, 'acorn', 'keys.log')
}

/** `HH:MM:SS.mmm`, local, because the reader comparing this to what they just pressed is here. */
const stamp = (at: Date): string =>
  `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`
  + `:${String(at.getSeconds()).padStart(2, '0')}.${String(at.getMilliseconds()).padStart(3, '0')}`

function installTrace(engine: TuiKeymap, renderer: CliRenderer): void {
  const file = logPath()
  try {
    mkdirSync(join(file, '..'), { recursive: true })
  } catch {
    // A log nobody can write is not worth taking the app down for.
    return
  }
  onCleanup(engine.intercept('key:after', (ctx) => {
    const node = renderer.currentFocusedRenderable
    const region = focusedRegion()
    // The one line that is a bug every time it says no: the renderer routes the keys and the store
    // draws the highlights, so a disagreement is a lit thing that does not answer
    // (docs/tui.md § The invariants, invariant 9).
    const agree = node === focusedRenderable() ? 'yes' : 'no'
    const depth = scopeDepth()
    const fields = [
      `key=${engine.formatKey(ctx.event.name ?? '?').padEnd(13)}`,
      `reason=${ctx.reason.padEnd(17)}`,
      `focused=${node ? `${node.constructor.name}#${node.id}` : 'none'}`,
      `region=${region ? `${region.paneId}/${region.regionId}` : 'none'}`,
      `scope=${depth === 1 ? 'screen' : `overlay:${depth}`}`,
      `agree=${agree}`,
    ]
    try {
      appendFileSync(file, `${stamp(new Date())} ${fields.join(' ')}\n`)
    } catch {
      // Same reason as above. A full disk is not a keyboard bug.
    }
  }))
}

/**
 * Install the keymap on the renderer and register the region chords.
 *
 * Returns the engine, because the composition root has one layer of its own to add — quitting, which
 * is the shell's and not an intent. Everything else reaches it through the singleton. The teardown is
 * the caller's, which on this host is the process ending.
 */
export function installKeymap(renderer: CliRenderer): TuiKeymap {
  // Which renderable has the keys is half of installing a keyboard, so the region store's
  // subscription to the renderer's focus event goes on here rather than at each of the three call
  // sites: the app, the shell harness and the kit's own renderer (./regions.ts § The one writer).
  installRegions(renderer)

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
    // clears what is on screen first and then climbs: from main it is the terse spelling of the same
    // spatial edge as Ctrl+Option+Left, and from the rail there is nothing above it, so with no
    // notification to clear it returns false and nothing happens.
    ['dismiss', () => clearNotifications() || moveBack()],
  ]
  const columnMoves: [Intent, () => boolean][] = [
    ['expand', () => moveColumn(1)],
    ['collapse', () => moveColumn(-1)],
  ]
  engine.registerLayer({
    priority: REGION,
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

  // Last, so the intercept sees a fully built engine, and only when asked for.
  if (process.env.ACORN_TUI_KEYS_TRACE) installTrace(engine, renderer)

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
