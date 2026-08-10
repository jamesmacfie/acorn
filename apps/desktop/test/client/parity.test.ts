import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { initClientPlugins } from '@acorn/client-core/registries/plugin.ts'
import { THEMES } from '@acorn/client-core/settings/themes.ts'
import { STYLES } from '@acorn/client-core/settings/uiStyles.ts'
import { coreSourceContributions } from '../../src/app/client/sourceContributions'
import { clientPlugins } from '../../src/app/client/plugins'

initClientPlugins(clientPlugins)
for (const source of coreSourceContributions) sourceRegistry.register(source)

// Compiled-client parity: the built-in panes with their shipped order and chords. Loaded frames are
// asserted by their package/e2e coverage instead of being smuggled back into this static graph — which is
// why `linear` (90, ⌘⇧L) is absent even though the pane and its chord still exist: both are manifest
// data now, in apps/node/scripts/build-plugin.mjs, and the chord is still unique because no compiled pane
// may claim it.
const PANES: Array<[id: string, order: number, chord: string | undefined]> = [
  ['pr', 10, 'meta+shift+r'],
  ['agents', 15, 'meta+shift+a'],
  ['changes', 20, 'meta+shift+g'],
  ['notes', 30, 'meta+shift+d'],
  ['context', 40, 'meta+shift+x'],
  ['editor', 50, 'meta+shift+e'],
  ['search', 60, 'meta+shift+f'],
  ['database', 70, 'meta+shift+j'],
  ['docker', 75, undefined],
  ['http', 76, 'meta+shift+h'],
  ['preview', 80, 'meta+shift+b'],
]

// Core Home is the stable default; Fleet is additive and gated on a second node. Provider browse sources
// remain optional contributions.
const SOURCES: Array<[id: string, order: number]> = [
  ['home', 0],
  ['fleet', 1],
  ['github', 10],
  ['docker', 40],
  ['http', 50],
  ['agents', 60],
]

describe('docs/ui-design.md § Parity — the panes', () => {
  it('is exactly the compiled panes, in their shipped order, with their shipped chords', () => {
    const actual = paneRegistry
      .entries()
      .map((pane) => [pane.id, pane.order, pane.defaultChord] as const)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    expect(actual).toEqual(PANES)
  })

  it('gives every chord to exactly one pane', () => {
    // A duplicate would resolve at runtime through the keybinding registry's conflict rules rather than
    // throwing, so the pane that lost would simply stop responding to its chord — silent, and precisely
    // the kind of thing a per-pane assertion above cannot see.
    const chords = PANES.map(([, , chord]) => chord).filter(Boolean)
    expect(new Set(chords).size).toBe(chords.length)
  })
})

describe('docs/ui-design.md § Parity — the rail sources', () => {
  it('is exactly the core and provider sources, in rail order', () => {
    // Read from the REGISTRY rather than through `availableSources`, deliberately: that accessor applies
    // the provider gate, so github vanishes without a connected integration — which is exactly why
    // this belongs in a unit test. Loaded sources have their own descriptor/runtime coverage.
    const actual = sourceRegistry
      .entries()
      .map((source) => [source.id, source.order] as const)
      .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    expect(actual).toEqual(SOURCES)
  })

  it('hides Fleet home until a second node is paired', () => {
    // docs/ui-design.md § New surfaces: "With only the bundled local node, this view stays out of the way; first-run
    // never mentions nodes at all." The gate is a `when` on the contribution, so it is checkable here
    // without a rendered rail.
    const fleet = sourceRegistry.entries().find((source) => source.id === 'fleet')
    expect(fleet?.when).toBeTypeOf('function')
    expect(fleet?.when?.()).toBe(false) // no fleet store in a unit test ⇒ zero nodes ⇒ hidden
  })
})

describe('docs/ui-design.md § Parity — appearance', () => {
  it('offers 12 themes and 4 style packs', () => {
    // "12 themes × 4 style packs (the two-axis appearance system)". themes.test.ts and uiStyles.test.ts
    // already check each list against the stylesheets that define it — i.e. that nothing is offered
    // without a pack behind it. Neither checks the COUNTS docs/ui-design.md actually commits to, which is a
    // different claim: a theme quietly dropped from BOTH the picker and the stylesheet passes those
    // drift guards and fails parity.
    expect(THEMES()).toHaveLength(12)
    expect(STYLES()).toHaveLength(4)
  })
})

// The shell's own chords are registered inside `onMount` in TabRail and TaskView, so a registry snapshot
// cannot see them without rendering — and vitest here has no DOM and no Solid transform
// (CLAUDE.md: a green suite proves nothing about UI). Scanned from source instead, with comments
// STRIPPED, the way apps/node's standaloneParity.test.ts does and for the same reason: a commented-out
// declaration would otherwise satisfy the assertion.
//
// Note the asymmetry with tools/arch/boundaries.test.ts, which deliberately does NOT strip comments —
// there a comment produces a loud false positive; here it would produce a silent false negative.
const HERE = dirname(fileURLToPath(import.meta.url))
const sourceOf = (relative: string): string =>
  readFileSync(join(HERE, relative), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1')

describe('docs/ui-design.md § Parity — the shell chords', () => {
  const tabRail = sourceOf('../../../../packages/client-core/src/tabs/TabRail.tsx')
  const taskView = sourceOf('../../src/app/client/TaskView.tsx')
  const app = sourceOf('../../src/app/client/App.tsx')

  it('binds ⌘⇧T to the terminal drawer and ⌘⇧N to a new task', () => {
    expect(taskView).toContain("'meta+shift+t'")
    expect(tabRail).toContain("'meta+shift+n'")
  })

  it('binds ⌘1–9 to the first nine TASKS', () => {
    // The shell binds the first nine task slots, not pane focus. Keep this assertion beside the
    // implementation because the shortcut is registered dynamically from the task rail.
    expect(tabRail).toContain('task.activate.${index + 1}')
    expect(tabRail).toContain('meta+${index + 1}')
  })

  it('binds ⌘, to settings and ⌘⇧↵ to maximize', () => {
    expect(app).toContain("'meta+,'")
    expect(app).toContain("'meta+shift+enter'")
  })

  it('derives every pane chord from the pane contribution rather than a second list', () => {
    // The one structural claim here: a pane's chord lives on its contribution, so a plugin changing it
    // cannot leave a stale copy in the shell. If this line ever stops being how TaskView binds them,
    // the ledger above stops covering what the app actually does.
    expect(taskView).toContain('pane.defaultChord')
  })
})
