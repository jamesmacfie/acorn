// What the keyboard will do right here, as a list of hints.
//
// Textual renders the focused widget's bindings as a footer strip; the cheat sheet is the same data
// with nothing left out. Both read this function, so nothing is declared twice
// (docs/tui.md § The footer).
//
// The source is the engine's own `getActiveKeys`, which answers for the layers that are active
// against whatever has focus right now — so a hint disappears when the thing that offered it does,
// and a key a rectangle or a trap has taken never shows. `client-core/host/keys/CheatSheet.tsx` reads
// the same call for the same reason.
//
// Asked once per change rather than once per render. The footer draws whenever anything on the screen
// does, and `getActiveKeys` walks every active layer, so the list is cached against the five things
// that move it (§ When the answer moves, § activeHints).
//
// What this file adds is the words. The engine knows a key is live; it does not know that `j` and `k`
// together are "move", because the intent layers bind anonymous handlers rather than named commands.
// The keys come from the host's own intent table, so a hint can never name a key nothing is bound to.

import { createSignal } from 'solid-js'
import type { Renderable } from '../tree/compat'
import type { OwnKeyEvent as KeyEvent } from '../ownKeys'
import { isTyping, keymap } from '@acorn/client-core/kit/keys/keymapHost.ts'
import { BARE_KEYS } from '@acorn/client-core/kit/keys/keymap.ts'
import { hostKeysFor } from '../keys/install'
import {
  focusedExpands, focusedItem, focusedRenderable, isField, isParentStop, isViewport, regionsInScope,
} from '../keys/regions'
import { focusedCrosses, focusedOpens } from '../keys/stops'
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
//
// `when` is for the rest of the question, where the engine's answer is not the whole of it. A layer
// knows nothing about scopes, so the region layer's Tab is registered and reported live inside a
// dialog even though a dialog has no regions to cycle. Only the store can say the key has nowhere to
// go (../keys/regions.ts § Scopes).
type Spec = Hint & { probe: string; when?: () => boolean }

/**
 * What has the keys, as the only thing the footer's words depend on.
 *
 * Six kinds and no seventh: the same key means a different thing on each, and a reader on a Merge
 * button should not be told Enter opens something. The order is a priority — a field that is also a
 * stop is a field, and a viewport is only ever a stop when it holds none (docs/tui.md § The footer).
 */
export type FocusedKind = 'item' | 'parent' | 'field' | 'opens' | 'viewport' | 'stop'

export const focusedKind = (): FocusedKind => {
  const node = focusedRenderable()
  // Through the store's own question rather than an `instanceof`, the same treatment `isViewport`
  // needed one slice earlier: under our painter a field is a plain object with a `kind`, and a footer
  // that read it as a stop told a reader Enter would press what they were typing into
  // (../keys/regions.ts § isField).
  if (node && isField(node)) return 'field'
  if (focusedItem()) return 'item'
  if (isParentStop(node)) return 'parent'
  if (focusedOpens()) return 'opens'
  // Through the store's own question rather than an `instanceof`, because under our painter a
  // viewport is a plain object and this row is what tells a reader the arrows scroll here
  // (../keys/regions.ts § isViewport).
  if (node && isViewport(node)) return 'viewport'
  return 'stop'
}

export type Words = { moveKeys: string; move: string; act: string; cross: string; commit: string }

/**
 * The words, one row per focused kind. `move` is the vertical pair, `act` is Enter, `cross` is the
 * horizontal pair, and `commit` is the chord.
 *
 * A table rather than a run of ternaries because the invariant is over the table: every kind says
 * something for every key, and the reachability suite reads the same rows the footer draws
 * (../reachability.test.tsx).
 *
 * The kind does not always settle the `cross` column, so read the words through `words()` below
 * rather than off this table (§ the cross word).
 */
export const WORDS: Record<FocusedKind, Words> = {
  // Down enters the panel the strip is showing and Up leaves the strip, so the pair is not a pair.
  parent: { moveKeys: 'j', move: 'enter', act: 'press', cross: 'tab', commit: 'commit' },
  item: { moveKeys: 'j/k', move: 'move', act: 'open', cross: 'fold', commit: 'commit' },
  // A field's bare keys are its own: `j`, `l` and Enter type, so their layers are inactive and the
  // engine never reports them live. The words are here for the table's sake and the footer draws the
  // chord alone (../keys/install.ts § typing).
  field: { moveKeys: 'j/k', move: 'move', act: 'press', cross: 'type', commit: 'send' },
  opens: { moveKeys: 'j/k', move: 'move', act: 'open', cross: 'column', commit: 'commit' },
  // A viewport is a stop only while it holds none, and then the arrows are the scroll
  // (../keys/regions.ts § stopsIn).
  viewport: { moveKeys: 'j/k', move: 'scroll', act: 'press', cross: 'column', commit: 'commit' },
  stop: { moveKeys: 'j/k', move: 'move', act: 'press', cross: 'column', commit: 'commit' },
}

/**
 * The words for what has the keys, with the cross word resolved.
 *
 * `h` and `l` are the one pair whose meaning is not settled by the kind alone, and the footer said
 * `fold` for every kind, which was true of one of them. Two questions settle it, and both are the
 * store's rather than the kind's:
 *
 *   does this collection fold?     a tree's rows expand and collapse; a plain list's decline the
 *                                  intent, and it bubbles to the region tier, which moves a column
 *   does this stop cross itself?   `DocumentTabs`, `SegmentedControl` and a chip row are each a
 *                                  horizontal collection drawn as one stop, so the pair moves inside
 *                                  them and never reaches the column
 *
 * Everything else bubbles, and the region tier has one meaning for a bubbled `h` or `l`: one column
 * left or right (../keys/regions.ts § moveColumn, docs/tui.md § The five key groups).
 */
export const words = (): Words => {
  const kind = focusedKind()
  const row = WORDS[kind]
  if (kind === 'field' || kind === 'parent') return row
  if (focusedCrosses()) return { ...row, cross: 'move' }
  if (kind === 'item') return { ...row, cross: focusedExpands() ? 'fold' : 'column' }
  return row
}

const specs = (): Spec[] => {
  const keys = hostKeysFor()
  const says = words()
  const bare = (intent: keyof typeof keys, at = 0): string => keys[intent][at] ?? keys[intent][0] ?? ''
  return [
    { probe: bare('next', 1), keys: says.moveKeys, label: says.move, detail: 'and the arrows' },
    { probe: bare('activate'), keys: 'enter', label: says.act, detail: 'or space' },
    { probe: bare('expand', 1), keys: 'h/l', label: says.cross, detail: 'and the arrows' },
    { probe: bare('search', 1), keys: '/', label: 'filter' },
    { probe: bare('menu'), keys: 'menu', label: 'menu' },
    { probe: bare('delete'), keys: 'del', label: 'delete' },
    { probe: bare('commit'), keys: keys.commit[0] ?? '', label: says.commit, detail: 'send what is in the box' },
    {
      probe: bare('nextRegion', 1),
      keys: 'tab',
      label: 'region',
      detail: 'shift+tab goes back; f6 does too',
      when: () => regionsInScope() > 1,
    },
    { probe: bare('nextPane'), keys: keys.nextPane[0] ?? '', label: 'pane', detail: 'the pane to the right' },
    { probe: bare('dismiss'), keys: 'esc', label: 'back' },
  ]
}

// ── When the answer moves ─────────────────────────────────────────────────────────────────────
//
// This file's header used to say the engine has no signal for "the active layers changed". It has
// one: `state`, which the engine emits when focus moves and when a layer is registered or
// unregistered, and both of those are exactly when a hint appears or goes. Reading it as a signal is
// what makes the cache below safe — a control mounting adds a key without focus, an overlay or a
// region moving anything, and the footer has to say so.
//
// One subscription per engine. A suite builds a renderer and an engine per test, so the previous
// one's listener is dropped when a new engine appears.
const [layerRevision, bumpLayers] = createSignal(0)
let watched: object | null = null
let stopWatching = (): void => {}

const watchLayers = (engine: { on: (name: 'state', fn: () => void) => () => void }): void => {
  if (watched === engine) return
  stopWatching()
  watched = engine
  stopWatching = engine.on('state', () => bumpLayers((at) => at + 1))
}

/** What the last answer was and what it was an answer to.
 *
 *  The footer draws once per render and a render happens for reasons that have nothing to do with the
 *  keyboard — a task list arriving, a terminal frame, a toast. `getActiveKeys` walks every active
 *  layer, so asking it per render was the cost this cache removes: the answer only moves when one of
 *  the four things below moves, and each of them is a signal or an identity
 *  (docs/performance.md § 2026-09-03 — phase 9). */
let last: {
  node: Renderable | null
  overlays: readonly unknown[]
  regions: number
  typing: boolean
  revision: number
  engine: object
  hints: Hint[]
} | null = null

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
  const node = focusedRenderable()
  const overlays = openOverlays()
  // And how many regions the keys can reach, which changes without focus moving: the rail hides on
  // Ctrl+B and the pane strip draws only while a task is open. Read here rather than only inside the
  // Tab hint's own probe, because that probe short-circuits — so on a render where the key is not
  // live the footer would take no dependency at all and keep whatever it last said
  // (../keys/regions.ts § regionsInScope).
  const regions = regionsInScope()
  const engine = keymap<Renderable, KeyEvent>()
  if (!engine) return []
  watchLayers(engine)
  // Whether somebody is typing, which is where the words move without focus moving: a field takes
  // the keys and the typing shadow goes on above every bare key on the screen
  // (../keys/tiers.ts § TYPING).
  const typing = isTyping()
  // And which layers are registered, which is the rest of the answer (§ When the answer moves).
  const revision = layerRevision()
  if (last
    && last.node === node && last.overlays === overlays && last.regions === regions
    && last.typing === typing && last.revision === revision && last.engine === engine) return last.hints

  // One ask, with the metadata. It was two — the plain list and then the same collect again for the
  // descriptions — and the second answers the first as well, because `includeMetadata` enriches the
  // same keys rather than choosing different ones (`@opentui/keymap` § ActiveKeysCaches).
  const active = engine.getActiveKeys({ includeMetadata: true })
  const live = new Set(active.map((key) => engine.formatKey(key.display)))
  const shown = specs()
    // A field's bare keys type. The typing shadow claims them so that nothing below it answers, which
    // means the engine now reports them live while a field has the keys — true of the shadow and a
    // lie to the reader, so the footer says what it always said and draws the chord alone
    // (§ WORDS.field, ../keys/tiers.ts § TYPING).
    .filter((spec) => !(typing && BARE_KEYS.has(spec.probe)))
    .filter((spec) => spec.probe && live.has(engine.formatKey(spec.probe)) && (spec.when?.() ?? true))
  const hint = ({ probe: _probe, when: _when, ...rest }: Spec): Hint => rest
  // Every command with a chord and a description of its own — the palette, the cheat sheet, quitting,
  // and whatever a plugin registered. These the engine does know the words for, because a command
  // layer binding carries them (../keys/commandLayer.ts).
  const commands = active
    .flatMap((key): Hint[] => {
      const desc = String(key.bindingAttrs?.desc ?? key.commandAttrs?.desc ?? '')
      return desc ? [{ keys: engine.formatKey(key.display), label: desc.toLowerCase() }] : []
    })
  // Move and open first because they are what a reader reaches for; the chords next because they are
  // the ones nobody can guess; the rest after, where the footer's own truncation reaches them first.
  const hints = [...shown.slice(0, 2).map(hint), ...commands, ...shown.slice(2).map(hint)]
  last = { node, overlays, regions, typing, revision, engine, hints }
  return hints
}

/** Test seam: the cache is module state and a suite renders many screens into one process. */
export function _resetHints(): void {
  last = null
  stopWatching()
  stopWatching = () => {}
  watched = null
}
