/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import type { CliRenderer, Renderable } from '@opentui/core'
import { focusedKind, words, activeHints, type FocusedKind } from './chrome/bindings'
import { renderFixture, type Caret, type Screen } from './harness'
import {
  _allStops, _columns, focusedInScope, focusedRegion, focusedRenderable, focusRenderable, onScreen,
  parentOf,
} from './keys/regions'
import { topology } from './chrome/topology'

// The focus model's invariants as properties over the pane roster, rather than one scenario per bug
// (docs/tui.md § Keys and focus).
//
// A scenario pins one path, and every bug the fourteen fix commits chased was a path nobody had
// written a scenario for. This walks every stop on every pane's first screen and asks the same five
// questions after every press, so a new pane or a new control joins the property the day it lands.
//
// The invariants this file owns are 1 (every stop is reachable), 3 (one caret), 4 (Escape is
// bounded), 6 (focus never sits on a corpse), 8 (the footer tells the truth), 9 (there is one focus
// value and it names a live node), 10 (focus stays inside the top scope) and 11 (a claimed key
// changed something, for the cross keys). Invariant 2 is the coverage test in ./kit/kit.test.tsx,
// and 5 and 7 are greps in ./invariants.test.ts.

/**
 * The panes the sweep opens, and the same six ./panes.test.tsx draws. A pane that joins the roster
 * joins both, and a pane that needs an exclusion here is a finding rather than an exclusion.
 *
 * `browse` is not a pane: it is the shell with no task opened, which is the rail plus a source
 * detail, and it is the only way the Menu, Browse and source regions get walked at all.
 *
 * `overlay` is not a pane either: it is the browse screen with a dialog over it, and it is the only
 * surface where the top scope is not the screen. Every question the store answers is answered inside
 * that scope, so the same walk asks whether anything reaches out of it, which is invariant 10
 * (./keys/regions.ts § Scopes).
 */
type Surface = {
  name: string
  pane?: string
  until: string
  /** Put the screen in the state the sweep is about, after its first draw. Awaited before the stops
   *  are counted, because a scope changes which of them exist. */
  open?: (screen: Screen) => Promise<void>
}

const SURFACES: Surface[] = [
  { name: 'browse', until: 'Invalidate' },
  { name: 'agents', pane: 'agents', until: 'MANAGED SESSIONS' },
  { name: 'pr', pane: 'pr', until: '#42' },
  { name: 'changes', pane: 'changes', until: 'STAGED' },
  { name: 'notes', pane: 'notes', until: 'Repro steps' },
  { name: 'context', pane: 'context', until: 'Working tree' },
  { name: 'editor', pane: 'editor', until: '$EDITOR' },
  {
    name: 'overlay',
    until: 'Invalidate',
    // The cheat sheet, because `?` is a key rather than a fixture and it draws a plain `Modal` with
    // nothing focusable in it. The scope's own last-resort stop is therefore its frame, which is the
    // hardest case for "the keys are somewhere a reader can see" (./chrome/CheatSheet.tsx).
    open: async (screen) => { await screen.press('?'); await screen.until('Keys') },
  },
]

/**
 * The two sizes, and why only one of them runs by default.
 *
 * Eight surfaces walked at eighty presses each is about three minutes on a warm worker, and doubling
 * it buys one thing: the layouts that split at a hundred cells draw both their columns. That is worth
 * running and it is not worth paying for on every save, so CI sets `ACORN_TUI_WIDE`
 * (docs/testing.md § Test layers).
 */
const SIZES: { width: number; height: number }[] = process.env.ACORN_TUI_WIDE
  ? [{ width: 80, height: 24 }, { width: 120, height: 40 }]
  : [{ width: 80, height: 24 }]

/** Presses per surface. Enough for the shell's five regions, a pane's own, and the stops in each. */
const BUDGET = 80

/** A renderable, as a failure message names it. */
const name = (node: Renderable | null): string => (node ? `${node.constructor.name}#${node.id}` : 'nothing')

/** Whether a renderable is in the tree under the root, which is invariant 9's half that `onScreen`
 *  does not answer: a detached subtree is visible all the way up its own parents and is nowhere at
 *  all. Nothing means the keys are nowhere, which is honest between a corpse and the landing pass. */
const attached = (node: Renderable | null, root: Renderable): boolean => {
  if (!node) return true
  for (let at: Renderable | null = node; at; at = at.parent) if (at === root) return true
  return false
}

/** Why a renderable is not on screen, for the message when invariant 6 fails. */
const offScreen = (node: Renderable | null): string => {
  if (!node) return 'nothing has the keys'
  if (node.isDestroyed) return `${name(node)} is destroyed`
  if (!node.visible) return `${name(node)} is hidden`
  for (let at: Renderable | null = node.parent; at; at = at.parent) {
    if (!at.visible) return `${name(node)} is inside a hidden ${name(at)}`
  }
  return `${name(node)} is on screen`
}

/** What a stop looks like to a person: the line it drew itself on. Used only to name a failure. */
const labelOf = (node: Renderable, frame: string): string =>
  (frame.split('\n')[node.y] ?? '').trim() || `${node.constructor.name} at row ${node.y}`

/** The questions, asked after every press. Each throws where it fails, naming the surface. */
const invariants = (where: string, caret: Caret, frame: string, renderer: CliRenderer): void => {
  // 9. There is one focus value, and it names a node that is really there.
  //
  //    This used to be "the renderer and the store agree about what has the keys", because focus was
  //    the renderer's and the store was a view of it: a disagreement was a lit thing that did not
  //    answer, which is what symptoms B and D looked like from the reader's seat. The store owns focus
  //    now and the renderer holds no opinion to disagree with, so what is left to ask is whether the
  //    one value is honest — the node is in the tree under the root, and it is still something that
  //    can hold the keys (./keys/regions.ts § The one owner, docs/tui.md § The invariants).
  const drawn = focusedRenderable()
  expect(attached(drawn, renderer.root), `${where}: the keys are on ${name(drawn)}, which is not in the tree`).toBe(true)
  if (drawn) expect(drawn.focusable, `${where}: the keys are on a node that cannot hold them`).toBe(true)

  // 10. Focus is inside the top scope. With a dialog open, no key moves the keys out of it: the
  //     store answers every question inside the scope, so there is nothing behind the dialog for a
  //     key to reach. Tab used to reach it, because the layer that contained the keys named the keys
  //     it contained and named the wrong ones (./keys/regions.ts § Scopes, docs/tui.md § Traps). On
  //     a surface with no dialog the screen is the scope, and then this is true of everything.
  expect(focusedInScope(), `${where}: ${name(drawn)} has the keys from outside the open scope`).toBe(true)

  // 3. One caret. The `›` is the caret and nothing else draws one, so counting them is the whole
  //    check. The lit half of the invariant is not here on purpose: focus draws `strong` + `accent`
  //    and so does an active tab label, so a span count cannot tell one from the other and a test
  //    that cannot tell is a test that fails on a passing screen.
  const carets = (frame.match(/›/g) ?? []).length
  expect(carets, `${where}: ${carets} carets, on ${caret.text.trim()}`).toBeLessThanOrEqual(1)

  // 6. Focus never sits on a corpse.
  //    Named in full, because the three ways off screen want three different fixes: destroyed is a
  //    landing that missed, hidden is a `visible` flip nothing looked again after, and a hidden
  //    ancestor is the shell's overlay row or a `TabPanel` (./keys/regions.ts § onScreen).
  expect(onScreen(drawn), `${where}: focus left on a node that is gone: ${offScreen(drawn)}`).toBe(true)

  // 8. The footer tells the truth: the word beside each bare key is the word this kind of focus
  //    promises (./chrome/bindings.ts § WORDS).
  const says = words()
  const hints = activeHints()
  const said = (keys: string): string | undefined => hints.find((hint) => hint.keys === keys)?.label
  for (const [keys, word] of [[says.moveKeys, says.move], ['enter', says.act], ['h/l', says.cross]] as const) {
    const label = said(keys)
    if (label === undefined) continue
    expect(label, `${where}: the footer offers "${keys} ${label}" on a ${focusedKind()}`).toBe(word)
  }
}

/** The frame without the strip at the bottom, which is the footer and any notification above it. What
 *  is being asked is whether a key changed the *content*, and the footer changes whenever focus does. */
const content = (frame: string): string => frame.split('\n').slice(0, -2).join('\n')

/**
 * Invariant 11 for the horizontal pair: press `l` and `h` and ask whether the footer's word came true.
 *
 * Invariant 8 by pressing rather than by reading. Reading catches a word that does not match the
 * table; only a press catches a table that does not match the app, which is what symptom C was — the
 * footer said `fold` on every kind, three of them folded nothing, and two of the five layers that
 * claimed the key moved nothing at all.
 *
 * Each word promises one of two outcomes, because the contract says an edge bubbles
 * (docs/tui.md § The five key groups):
 *
 *   column   the keys are in a different column
 *   tab      the strip's marked tab moved
 *   fold     the rows the collection draws changed
 *   move     the horizontal collection moved inside itself
 *
 * and in every case, bubbling instead. A bubbled cross key has exactly one meaning at the region
 * tier, which is the column move, so "it bubbled" and "there was no column that way, and there is no
 * wrap" are the same escape and both are honest. For `column` that escape is the whole check: with a
 * column in that direction the keys must be in it afterwards, which is the assertion a `list-detail`
 * pane used to fail (./keys/regions.ts § moveColumn, docs/tui.md § Focus regions).
 *
 * A field is skipped. Its `h` and `l` type, the footer never offers the pair there because the
 * bindings are inactive while somebody is typing, and pressing would put an `l` in a filter box and
 * change the screen the next kind is measured against.
 */
const crossKeys = async (where: string, screen: Screen, met: Map<FocusedKind, Renderable>): Promise<void> => {
  for (const [kind, node] of met) {
    if (kind === 'field') continue
    // The walk may have destroyed what it stood on — a tab switch replaces a panel — and a node that
    // will not take the keys back is not a case any more.
    if (!focusRenderable(node) || focusedKind() !== kind) continue
    for (const key of ['l', 'h'] as const) {
      const word = words().cross
      const before = { content: content(await screen.frame()), columns: _columns() }
      await screen.press(key)
      const after = { content: content(await screen.frame()), columns: _columns() }
      invariants(`${where}: after ${key} on a ${kind}`, await screen.caret(), await screen.frame(), screen.renderer)

      const at = before.columns.at
      const beyond = at === null
        ? false
        : before.columns.all.some((x) => (key === 'l' ? x > at : x < at))
      const bubbled = after.columns.at !== at || !beyond
      const changed = after.content !== before.content
      const held = word === 'column' ? bubbled : changed || bubbled
      expect(held, `${where}: the footer says "h/l ${word}" on a ${kind} and ${key} did nothing`).toBe(true)
    }
  }
}

const sweep = async (surface: Surface, size: typeof SIZES[number]): Promise<void> => {
  const where = `${surface.name} at ${size.width} by ${size.height}`
  const screen: Screen = await renderFixture({ ...size, ...(surface.pane ? { pane: surface.pane } : {}) })
  try {
    await screen.until(surface.until, 45)
    await surface.open?.(screen)
    const owed = _allStops()
    // Anti-vacuity: a screen with nothing focusable on it would pass every assertion below.
    expect(owed.length, `${where}: nothing focusable on screen`).toBeGreaterThan(0)

    const reached = new Set<Renderable>()
    // One node per kind of focused thing the walk met, so the cross keys can be asked about each kind
    // once rather than about all eighty stops. The first is kept: the walk reads down the screen, so
    // the first of a kind is the one a reader meets first (§ crossKeys).
    const met = new Map<FocusedKind, Renderable>()
    await screen.walk(BUDGET, async (caret) => {
      const node = focusedRenderable()
      if (node) reached.add(node)
      if (node && !met.has(focusedKind())) met.set(focusedKind(), node)
      invariants(where, caret, await screen.frame(), screen.renderer)
    })

    // 1. Every declared stop is reachable. A stop the walk destroyed on the way past — a panel that
    //    a tab switch replaced — is not owed, because it is no longer on the screen being asked about.
    const frame = await screen.frame()
    const missed = owed.filter((node) => !reached.has(node) && onScreen(node))
    expect(missed.map((node) => labelOf(node, frame)), `${where}: ${missed.length} stops the walk never landed on`).toEqual([])

    // 11. And a claimed key changed something. After the walk, because pressing `l` and `h` moves the
    //     keys and opens things, and the walk order is fixed on purpose (§ crossKeys).
    await crossKeys(where, screen, met)
  } finally {
    screen.done()
  }
}

describe('every stop is reachable, and the invariants hold on the way', () => {
  const cases = SIZES.flatMap((size) => SURFACES.map((surface) => [`${surface.name} at ${size.width} by ${size.height}`, surface, size] as const))
  it.each(cases)('%s', async (_name, surface, size) => {
    await sweep(surface, size)
  }, 180_000)
})

// ── Escape is bounded ─────────────────────────────────────────────────────────────────────────
//
// Invariant 4, and one walk per surface rather than one per stop. What the invariant is really about
// is that the climb terminates in the rail, and the deepest stop the walk reaches is the only place
// that can fail: from anywhere shallower the same climb is a prefix of this one.

/**
 * How many Escapes the climb out of here is allowed to take.
 *
 * `focus-model.md` said `depth + 1`, counting only the parent stops above the caret. That is short by
 * the region chain, and it is short by two on every task pane: a pane's own region climbs to the pane
 * strip and the strip climbs to Tasks, and neither hop is a parent stop. The bound is the parent
 * stops plus the chain `chrome/topology.ts` names, plus the one press that leaves the last stop.
 */
const escapesFrom = (node: Renderable | null): number => {
  let depth = 0
  for (let at = node ? parentOf(node) : undefined; at; at = parentOf(at)) depth += 1
  for (let at = focusedRegion(); at; at = topology.home(at)) depth += 1
  return depth
}

describe('escape is bounded', () => {
  // The screen surfaces only. Escape inside a scope closes the scope, which is the trap's own
  // contract and ../keys/keys.test.tsx's case; it is not the climb this property is about, and a
  // surface that opens a dialog would spend its first Escape closing it (./keys/trap.ts).
  const climbs = SURFACES.filter((surface) => !surface.open)
  it.each(climbs.map((surface) => [surface.name, surface] as const))('%s climbs to the rail', async (name, surface) => {
    const screen = await renderFixture({ width: 80, height: 24, ...(surface.pane ? { pane: surface.pane } : {}) })
    try {
      await screen.until(surface.until, 45)
      // Down to the deepest thing the arrows reach in the region that opens the screen.
      await screen.walk(12)
      const budget = escapesFrom(focusedRenderable())
      for (let press = 0; press < budget; press += 1) await screen.press('ESCAPE')
      // The rail is where a climb ends: Menu, Browse or Tasks. Escape from there is the shell's own
      // layer and clears a notification rather than moving the keys (./chrome/topology.ts).
      const landed = focusedRegion()
      expect(['menu', 'browse', 'tasks'], `${name}: ${budget} escapes landed in ${landed?.paneId}/${landed?.regionId}`)
        .toContain(landed?.regionId)
    } finally {
      screen.done()
    }
  }, 180_000)
})
