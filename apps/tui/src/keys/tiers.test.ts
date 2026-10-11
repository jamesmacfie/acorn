/** @jsxImportSource @acorn/tui/jsx */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { toast } from '@acorn/client-core/features/notifications'
import { renderFixture } from '../harness'
import { focusedRegion } from './regions'
import { COLLECTION, COMMAND, LIST, OVERLAY_OWN, PANE, PARENT, RECTANGLE, REGION, STOP, TRAP, TYPING } from './tiers'

// The tier table, as the two things that can actually be checked.
//
// The property worth having is "no two layers at one tier bind the same key with the same target mode
// and target", and it cannot be written: `@opentui/keymap` 0.5.9 has no public way to enumerate the
// registered layers, and reaching into the engine's own state would test its internals rather than
// this app.
//
// So the property is two checks, and between them they cover the two ways the table goes wrong:
//
//   a grep      a number spelled outside ./tiers.ts, which is how a new tier appears without
//               anybody deciding on one
//   a press     two Escapes at the region tier. A rendered test rather than a grep, because the
//               fault is the order two layers register in, and only a press can see an order
//
// Do not go looking for the enumeration API. If a release adds one, this file is where the two checks
// collapse back into one (docs/tui/keys.md § The five key groups).

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)]))
    .filter((file) => /\.tsx?$/.test(file))

/** A priority as an object field: `{ priority: 40 }`, which is how a layer and an intercept take one. */
const AS_A_FIELD = /priority:\s*\d/

/**
 * A priority as `bindKeys`'s third argument, which follows the bindings array or the `.map()` that
 * built it: `], 45, { mode: 'focus' })` or `})), 30)`.
 *
 * Held to the eleven values the table names plus 35, a retired tier, so an ordinary number in an
 * ordinary call — `slice(at, 2)`, `Math.max(a[i], 0)` — is not a false alarm. A relapse spells one of
 * these, because a relapse is somebody re-adding a tier.
 */
const AS_AN_ARGUMENT = /[\])],\s*(?:0|5|30|35|36|40|41|42|45|60|61|200)\s*(?:\)|,\s*\{)/

describe('the tiers are named in one place', () => {
  it('spells a keymap priority in tiers.ts and nowhere else', () => {
    // The same shape as the greps in ../invariants.test.ts, and for the same reason: what this forbids
    // is a second place to put a decision.
    const spelled = filesIn(ROOT)
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => file !== join(ROOT, 'keys', 'tiers.ts'))
      .filter((file) => {
        const text = readFileSync(file, 'utf8')
        return AS_A_FIELD.test(text) || AS_AN_ARGUMENT.test(text)
      })
      .map((file) => file.slice(ROOT.length))
      .sort()
    expect(spelled).toEqual([])
  })

  it('names eleven tiers, ordered, with no two the same', () => {
    // Anti-vacuity for the grep above, which passes on an empty table. The order is the whole meaning
    // of the numbers: a rectangle above a trap above a strip above a stop above the typing shadow
    // above a list, and the screen's own keys below everything a pane draws.
    const table = [RECTANGLE, OVERLAY_OWN, TRAP, PARENT, STOP, TYPING, COLLECTION, LIST, PANE, REGION, COMMAND]
    expect(table).toHaveLength(11)
    expect(new Set(table).size).toBe(11)
    expect([...table].sort((a, b) => b - a)).toEqual(table)
    // And the one row this package states without setting: it is `registerIntentLayer`'s default in
    // client-core, which the desktop reads too, so a change there and not here would be a table that
    // lies (./tiers.ts § COLLECTION).
    expect(COLLECTION).toBe(40)
    // The typing shadow sits between the collection and the stop, and that placement is the design
    // rather than an accident of numbering: everything at or below it reaches a focused field from
    // outside and has to go quiet while somebody types, and everything above it is bound to the
    // focused renderable itself (./tiers.ts § TYPING).
    expect(TYPING).toBe(COLLECTION + 1)
    expect(STOP).toBe(TYPING + 1)
  })
})

describe('one Escape at the region tier', () => {
  it('clears what is on screen first, then climbs', async () => {
    // Notification dismiss and the region chain's `moveBack` both answer Escape at the region tier.
    // As two layers they would answer in registration order; as one handler the order is a line of
    // code (./install.ts § clearNotifications).
    const screen = await renderFixture({ width: 100, height: 28, pane: 'notes' })
    try {
      await screen.until('Scratchpad')
      // Into the pane, so there is a region chain above the keys to climb: rail, pane strip, pane.
      await screen.press('TAB')
      await screen.press('TAB')
      const inside = focusedRegion()
      expect(inside?.paneId).toBe('notes')

      toast('Saved.')
      expect(await screen.frame()).toContain('Saved.')

      // First Escape clears the notification and leaves the keys where they were. A reader pressing
      // Escape to get a line out of their way did not ask to leave the pane.
      await screen.press('ESCAPE')
      const cleared = await screen.frame()
      expect(cleared).not.toContain('Saved.')
      expect(focusedRegion()).toEqual(inside)

      // Second Escape has nothing to clear, so it climbs.
      await screen.press('ESCAPE')
      expect(focusedRegion()?.regionId).toBe('panes')
    } finally {
      screen.done()
    }
  }, 60_000)
})
