/** @jsxImportSource @opentui/solid */
import { describe, expect, it } from 'vitest'
import type { Renderable } from '@opentui/core'
import { focusedKind, WORDS, activeHints } from './chrome/bindings'
import { hasFfi } from './ffi'
import { renderFixture, type Caret, type Screen } from './harness'
import { _allStops, focusedRegion, focusedRenderable, parentOf } from './keys/regions'
import { topology } from './chrome/topology'

// The focus model's invariants as properties over the pane roster, rather than one scenario per bug
// (docs/tui.md § Keys and focus).
//
// A scenario pins one path, and every bug the fourteen fix commits chased was a path nobody had
// written a scenario for. This walks every stop on every pane's first screen and asks the same four
// questions after every press, so a new pane or a new control joins the property the day it lands.
//
// The invariants this file owns are 1 (every stop is reachable), 3 (one caret), 4 (Escape is
// bounded), 6 (focus never sits on a corpse) and 8 (the footer tells the truth). Invariant 2 is the
// coverage test in ./kit/kit.test.tsx, and 5 and 7 are greps in ./invariants.test.ts.

/**
 * The panes the sweep opens, and the same six ./panes.test.tsx draws. A pane that joins the roster
 * joins both, and a pane that needs an exclusion here is a finding rather than an exclusion.
 *
 * `browse` is not a pane: it is the shell with no task opened, which is the rail plus a source
 * detail, and it is the only way the Menu, Browse and source regions get walked at all.
 */
const SURFACES: { name: string; pane?: string; until: string }[] = [
  { name: 'browse', until: 'Invalidate' },
  { name: 'agents', pane: 'agents', until: 'MANAGED SESSIONS' },
  { name: 'pr', pane: 'pr', until: '#42' },
  { name: 'changes', pane: 'changes', until: 'STAGED' },
  { name: 'notes', pane: 'notes', until: 'Repro steps' },
  { name: 'context', pane: 'context', until: 'Working tree' },
  { name: 'editor', pane: 'editor', until: '$EDITOR' },
]

/**
 * The two sizes, and why only one of them runs by default.
 *
 * Seven surfaces walked at eighty presses each is about three minutes on a warm worker, and doubling
 * it buys one thing: the layouts that split at a hundred cells draw both their columns. That is worth
 * running and it is not worth paying for on every save, so CI sets `ACORN_TUI_WIDE`
 * (docs/testing.md § Test layers).
 */
const SIZES: { width: number; height: number }[] = process.env.ACORN_TUI_WIDE
  ? [{ width: 80, height: 24 }, { width: 120, height: 40 }]
  : [{ width: 80, height: 24 }]

/** Presses per surface. Enough for the shell's five regions, a pane's own, and the stops in each. */
const BUDGET = 80

/** Whether a renderable is still on screen: alive, visible, and visible all the way up. */
const onScreen = (node: Renderable | null): boolean => {
  if (!node || node.isDestroyed || !node.visible) return false
  for (let at: Renderable | null = node.parent; at; at = at.parent) if (!at.visible) return false
  return true
}

/** What a stop looks like to a person: the line it drew itself on. Used only to name a failure. */
const labelOf = (node: Renderable, frame: string): string =>
  (frame.split('\n')[node.y] ?? '').trim() || `${node.constructor.name} at row ${node.y}`

/** The four questions, asked after every press. Each throws where it fails, naming the surface. */
const invariants = (where: string, caret: Caret, frame: string): void => {
  // 3. One caret. The `›` is the caret and nothing else draws one, so counting them is the whole
  //    check. The lit half of the invariant is not here on purpose: focus draws `strong` + `accent`
  //    and so does an active tab label, so a span count cannot tell one from the other and a test
  //    that cannot tell is a test that fails on a passing screen.
  const carets = (frame.match(/›/g) ?? []).length
  expect(carets, `${where}: ${carets} carets, on ${caret.text.trim()}`).toBeLessThanOrEqual(1)

  // 6. Focus never sits on a corpse.
  expect(onScreen(focusedRenderable()), `${where}: focus left on a node that is gone`).toBe(true)

  // 8. The footer tells the truth: the word beside each bare key is the word this kind of focus
  //    promises (./chrome/bindings.ts § WORDS).
  const words = WORDS[focusedKind()]
  const hints = activeHints()
  const said = (keys: string): string | undefined => hints.find((hint) => hint.keys === keys)?.label
  for (const [keys, word] of [[words.moveKeys, words.move], ['enter', words.act], ['h/l', words.cross]] as const) {
    const label = said(keys)
    if (label === undefined) continue
    expect(label, `${where}: the footer offers "${keys} ${label}" on a ${focusedKind()}`).toBe(word)
  }
}

const sweep = async (surface: typeof SURFACES[number], size: typeof SIZES[number]): Promise<void> => {
  const where = `${surface.name} at ${size.width} by ${size.height}`
  const screen: Screen = await renderFixture({ ...size, ...(surface.pane ? { pane: surface.pane } : {}) })
  try {
    await screen.until(surface.until, 45)
    const owed = _allStops()
    // Anti-vacuity: a screen with nothing focusable on it would pass every assertion below.
    expect(owed.length, `${where}: nothing focusable on screen`).toBeGreaterThan(0)

    const reached = new Set<Renderable>()
    await screen.walk(BUDGET, async (caret) => {
      const node = focusedRenderable()
      if (node) reached.add(node)
      invariants(where, caret, await screen.frame())
    })

    // 1. Every declared stop is reachable. A stop the walk destroyed on the way past — a panel that
    //    a tab switch replaced — is not owed, because it is no longer on the screen being asked about.
    const frame = await screen.frame()
    const missed = owed.filter((node) => !reached.has(node) && onScreen(node))
    expect(missed.map((node) => labelOf(node, frame)), `${where}: ${missed.length} stops the walk never landed on`).toEqual([])
  } finally {
    screen.done()
  }
}

describe.skipIf(!hasFfi)('every stop is reachable, and the invariants hold on the way', () => {
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

describe.skipIf(!hasFfi)('escape is bounded', () => {
  it.each(SURFACES.map((surface) => [surface.name, surface] as const))('%s climbs to the rail', async (name, surface) => {
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
