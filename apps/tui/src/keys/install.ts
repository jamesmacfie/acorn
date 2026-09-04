// The keymap, installed once on the renderer.
//
// `client-core/host/keys/install.ts` names this file's seam in its own header: "its terminal adapter,
// which we do not use yet, is in the same package". Same engine, same `intentKeys` table, the same
// tiers ordered by priority, a different pair of type parameters: `Keymap<Renderable, KeyEvent>`
// where the DOM's is `Keymap<HTMLElement, HtmlKeymapEvent>`. The host adapter the engine is built
// from is this package's own, because where the engine asks who has the keys is the one thing the
// package's own terminal adapter got wrong (./keymapHost.ts).
//
// The tiers and the sentence for each are in ./tiers.ts, which is the one file in this package that
// spells a priority. This one registers the `REGION` tier: region, pane and column movement, global,
// because moving between them starts anywhere.
//
// A binding whose handler returns false is not handled, so dispatch carries on to the next layer.
// That is how an intent bubbles: the focused collection answers it, or the region layer does, or
// nothing does. Which is also why a handler that changed nothing must say so
// (docs/tui.md § The five key groups).

import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { onCleanup } from 'solid-js'
import { Keymap, type TargetMode } from '@opentui/keymap'
import { registerDefaultKeys, registerEnabledFields, registerMetadataFields } from '@opentui/keymap/addons'
import type { Renderable } from '../tree/compat'
import type { Renderer } from '../renderer'
import type { KeyEvent } from '../keyEvent'
import { keymap, keysFor, setKeymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import type { Intent } from '@acorn/client-core/kit/keys/intents.ts'
import { BARE_KEYS } from '@acorn/client-core/kit/keys/keymap.ts'
import { activeToasts, dismissToast } from '@acorn/client-core/features/notifications/toast.ts'
import {
  focusedRegion, focusedRenderable, installRegions, isField, moveBack, moveColumn, moveRegion,
  movePane, onFocusMove, scopeDepth, walkSteps,
} from './regions'
import { tuiKeymapHost } from './keymapHost'
import { REGION, TYPING } from './tiers'

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
//
// Through an appending stream rather than `appendFileSync`, because the second thing this flag is for
// is measuring, and a synchronous `open`, `write` and `close` on the loop that draws is a trace that
// measures itself: on this machine it is about a fifth of a millisecond per key, on the same loop
// that has to answer the key. A stream opened once and written to buffers the line and flushes it
// when the loop is idle, which is what a log wants and what a measurement needs.

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

/** The open log, or null where the state directory could not be made. One per process: the flag is
 *  read once at install and a suite installs the keyboard per test, so the stream is reused rather
 *  than reopened. */
let log: WriteStream | null = null

const openLog = (): WriteStream | null => {
  if (log) return log
  const file = logPath()
  try {
    mkdirSync(join(file, '..'), { recursive: true })
    log = createWriteStream(file, { flags: 'a' })
    // A full disk is not a keyboard bug, and an unhandled `error` on a stream is an uncaught
    // exception rather than a returned code.
    log.on('error', () => {})
  } catch {
    // A log nobody can write is not worth taking the app down for.
    return null
  }
  return log
}

function installTrace(engine: TuiKeymap): void {
  const file = openLog()
  if (!file) return
  onCleanup(engine.intercept('key:after', (ctx) => {
    // The store, which is the only answer there is: the line used to carry an `agree` field beside
    // this, for the renderer's own idea of focus, and a disagreement was the commonest bug this app
    // had. There is nothing left to disagree (./regions.ts § The one owner).
    const node = focusedRenderable()
    const region = focusedRegion()
    const depth = scopeDepth()
    const fields = [
      `key=${engine.formatKey(ctx.event.name ?? '?').padEnd(13)}`,
      `reason=${ctx.reason.padEnd(17)}`,
      `focused=${node ? `${node.constructor.name}#${node.id}` : 'none'}`,
      `region=${region ? `${region.paneId}/${region.regionId}` : 'none'}`,
      `scope=${depth === 1 ? 'screen' : `overlay:${depth}`}`,
      // How many renderables the walks behind this key visited. The number the phase 9 work is
      // about: a key press should cost the depth of the focus tree and not the size of the region
      // (./regions.ts § The step counter).
      `steps=${walkSteps.take()}`,
    ]
    file.write(`${stamp(new Date())} ${fields.join(' ')}\n`)
  }))
}

// ── The typing shadow ─────────────────────────────────────────────────────────────────────────
//
// While an `Input` or a `Textarea` has the keys, the bare keys type. That used to be said once per
// binding, as `active: () => !typing()` on every bare key of every control on screen, and the engine
// counts a binding with a runtime matcher as a reason to switch its active-key cache off — for the
// whole process, not for that layer. The footer asks the engine what is live on every render, so the
// cost of saying it that way was a full collect over every active layer per render, forever
// (./tiers.ts § TYPING).
//
// Said once instead, as a layer that is registered when a field takes the keys and unregistered when
// it loses them. `preventDefault: false` is the whole trick: the binding claims the key *inside* the
// keymap, so nothing below the shadow's tier ever sees it, and the key still gets typed. That is the
// same shape as a `Modal`'s key claim — a scope, not a swallow — with one difference worth stating:
// a scope is pushed by the box that is drawn, and this follows focus instead, because "is the focused
// thing a field" is a fact about focus (./regions.ts § The one owner, docs/tui.md § Focus regions).

/** The keys a field types. The shared table, so the shadow cannot name a key the bindings below it
 *  do not, which is the drift that made the old swallow layer leak Tab (./trap.ts). */
const SHADOWED = [...BARE_KEYS]

/** The live shadow's disposer, or null while nobody is typing. Module state for the same reason
 *  `installRegions`'s subscription is: a suite builds a renderer per test. */
let stopShadow: (() => void) | null = null

/** Is the thing with the keys a field? The one question the shadow and the hand-off both ask, and
 *  `./regions.ts § isField` is where it is answered: the two `instanceof`s that used to be here were
 *  false under our painter, which is why nothing typed under it. */
const isTypingTarget = (node: Renderable | null): boolean => !!node && isField(node)

/**
 * Type the key into the field that has the keys, once nothing else has claimed it.
 *
 * The hand-off. A key used to reach an edit buffer because the *renderer* had focused it: `focus()`
 * installs a handler that calls `handleKeyPress`, and the renderer runs those only after every
 * ordinary listener and only while nothing has called `preventDefault`. With the store owning focus
 * that route is a coincidence — it works while the caret mirror happens to agree — so the dispatcher
 * says it instead. `TextareaRenderable.handleKeyPress` reads the key and its own suspend trait and
 * nothing else, so calling it directly is the whole of typing
 * (docs/future/terminal-rewrite/phase-0-baseline-and-spikes.md § Spike 1).
 *
 * Claimed afterwards, so the renderer's own route does not type the same key a second time into the
 * node the caret mirror focused. A key some binding took arrives prevented and is left alone, and the
 * typing shadow's bindings carry `preventDefault: false` for exactly this reason: a bare `j` is
 * claimed inside the keymap, so nothing below the shadow's tier answers it, and it still gets typed
 * (§ The typing shadow).
 */
const typeInto = (event: KeyEvent): void => {
  if (event.defaultPrevented) return
  const node = focusedRenderable()
  if (!node || !isTypingTarget(node)) return
  // Whichever painter drew it, the field answers the same call. OpenTUI's edit buffer has
  // `handleKeyPress` from `TextareaRenderable`; ours is installed on the node by the component that
  // owns the model, from its `ref`, which is where a widget's imperative API goes under this painter
  // (../kit/asking.tsx § api).
  node.handleKeyPress?.(event)
  event.preventDefault()
}

/**
 * Hand a bracketed paste to whatever has the keys and can take one.
 *
 * The same hand-off as `typeInto` one event over, and it is registered only under our painter because
 * OpenTUI already has a route: its renderer delivers a paste to the renderable *it* has focused, and
 * the caret mirror has focused the same field, so a second listener would paste twice. Phase 4 leaves
 * this one (./regions.ts § paintCaret).
 *
 * `isTypingTarget` is deliberately not the gate here, where it is the gate for a key. Two things
 * install a `handlePaste`: a field, and the box of a `pty` rectangle, which brackets the text for the
 * program inside it if that program asked. The second is not a typing target — an entered rectangle
 * takes its keys by intercepting above every layer rather than through this predicate — so asking the
 * question would refuse a paste into the one place a reader most expects one to work
 * (../kit/rectangle.tsx § pasted, ../kit/asking.tsx § api).
 */
const pasteInto = (event: { text?: string; bytes?: Uint8Array }): void => {
  const node = focusedRenderable()
  if (!node) return
  const text = event.text ?? (event.bytes ? new TextDecoder().decode(event.bytes) : '')
  if (text !== '') (node as unknown as { handlePaste?: (event: { text: string }) => void })
    .handlePaste?.({ text })
}

const syncTypingShadow = (engine: TuiKeymap): void => {
  const wanted = isTypingTarget(focusedRenderable())
  if (wanted === !!stopShadow) return
  if (!wanted) {
    stopShadow?.()
    stopShadow = null
    return
  }
  stopShadow = engine.registerLayer({
    priority: TYPING,
    bindings: SHADOWED.map((key) => ({
      key,
      // Claimed here and nowhere below.
      cmd: () => true,
      // And still delivered to the field. Without this the engine calls `preventDefault` on the
      // event and the edit buffer never sees the character.
      preventDefault: false,
    })),
  })
}

/**
 * Install the keymap on the renderer and register the region chords.
 *
 * Returns the engine, because the composition root has one layer of its own to add — quitting, which
 * is the shell's and not an intent. Everything else reaches it through the singleton. The teardown is
 * the caller's, which on this host is the process ending.
 */
export function installKeymap(renderer: Renderer): TuiKeymap {
  // Which renderable has the keys is half of installing a keyboard, so the region store's
  // subscription to the renderer's focus event goes on here rather than at each of the three call
  // sites: the app, the shell harness and the kit's own renderer (./regions.ts § The one owner).
  installRegions(renderer)

  // The engine, from this package's own host adapter, plus the three addons the package's
  // `createDefaultOpenTuiKeymap` registers: the binding parser, `active` on a layer or command, and
  // the metadata fields the footer reads (./keymapHost.ts).
  const engine = new Keymap(tuiKeymapHost(renderer))
  registerDefaultKeys(engine)
  registerEnabledFields(engine)
  registerMetadataFields(engine)

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
    typing: () => isTypingTarget(focusedRenderable()),
    // And this host says the gate once, as a layer, rather than once per bare-key binding
    // (§ The typing shadow).
    shadowsTyping: true,
  })

  // The shadow follows the store, which is the one answer to "is somebody typing" (./regions.ts
  // § onFocusMove). Nothing unsubscribes it: the subscription belongs to the renderer being installed
  // on, and `installRegions` above dropped the last renderer's along with its click handler.
  stopShadow?.()
  stopShadow = null
  onFocusMove(() => syncTypingShadow(engine))

  // And the keys a field types, handed to it after the engine has had its say (§ typeInto). An
  // ordinary listener, so it runs after the engine's prepended one and before the renderer routes
  // anything to a renderable of its own.
  renderer.keyInput.on('keypress', typeInto)
  // …and a whole paste beside it, on the same stream, because that is where the parser puts one
  // (§ pasteInto).
  renderer.keyInput.on('paste', pasteInto as (event: unknown) => void)

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
      // Left and right inside a field move its cursor, so spatial movement is inactive for every
      // typing target, arrow-key spellings included. Said by the typing shadow above this tier
      // rather than by a matcher on each of these, which is what the region and pane chords above
      // do not want and these four do (§ The typing shadow).
      ...columnMoves.flatMap(([intent, run]) => map[intent].map((key) => ({ key, cmd: run }))),
    ],
  })

  // Last, so the intercept sees a fully built engine, and only when asked for.
  if (process.env.ACORN_TUI_KEYS_TRACE) installTrace(engine)

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
  /** A binding that has to fire while somebody is typing says so with its tier rather than with an
   *  option: the typing shadow sits at `TYPING`, so anything at `STOP` or above is bound to the
   *  focused renderable itself and is never shadowed (./tiers.ts § TYPING, ../kit/asking.tsx). */
  options: { mode?: TargetMode } = {},
): void {
  // Read through the singleton rather than threaded, so a layout or a modal deep in a tree can bind
  // without every component above it carrying the engine.
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return
  onCleanup(engine.registerLayer({
    target,
    targetMode: options.mode ?? 'focus-within',
    priority,
    bindings: bindings.map(({ key, cmd }) => ({ key, cmd })),
  }))
}
