import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KIT_NODES, type KitNodeName } from '@acorn/protocol/tree/nodes.ts'
import { KIT_COMPONENTS } from './components'
import { kitComponent, type KitEntry } from './kitEntry'

// The DOM host's kit table: every node in the kit has an entry, and the entries that would drag a
// feature or a highlighter into the first paint are loaders rather than components
// (docs/plugins.md § The tree contract).
//
// The heavy list is this test's, not the table's, which is the point of writing it down twice. A
// heavy component added to the table eagerly fails here, with the name in the message, before it
// fails the renderer's startup budget with a chunk hash in the message
// (apps/desktop/scripts/check-renderer-budget.mjs).
//
// A `.test.tsx` because it imports the table, and the table's entries are Solid components: the
// `logic` project has no Solid transform and refuses the first `.tsx` it reaches (vitest.config.ts).
// Nothing here renders, though — it only asks what shape each entry is, and a loader is never called.
const HEAVY: KitNodeName[] = [
  // The diff viewer and the four rows that share `kit/diff/DiffRows.tsx` with it. `DiffPane` reaches
  // features/diff, and through it infra/highlight, which is the syntax highlighter.
  'DiffPane', 'DiffLine', 'FileHead', 'NonCodeRow', 'SplitCell',
  // Fetches a grammar per fence at render time, and is the surface a streaming transcript re-renders.
  'Markdown',
  // Carries the follow-scroll machinery.
  'Timeline',
  // Reaches features/settings.
  'ModelConnectionPicker',
]

const isLoader = (entry: KitEntry): boolean => typeof entry !== 'function'

describe('the DOM host\'s kit table', () => {
  it('has an entry for every node in the kit, and nothing else', () => {
    expect(Object.keys(KIT_COMPONENTS).sort()).toEqual([...KIT_NODES].sort())
    // Anti-vacuity: two empty lists compare equal.
    expect(KIT_NODES.length).toBeGreaterThan(60)
  })

  it('holds a loader for every heavy node', () => {
    const eager = HEAVY.filter((name) => !isLoader(KIT_COMPONENTS[name]))
    expect(eager, 'these are heavy and must be loaders, not components').toEqual([])
  })

  it('holds the component itself for every cheap node', () => {
    // The other half of the rule. A `Button` behind a dynamic import costs a frame for nothing, so a
    // loader that creeps onto a primitive is a regression too.
    const heavy = new Set<string>(HEAVY)
    const lazyPrimitives = KIT_NODES.filter((name) => !heavy.has(name) && isLoader(KIT_COMPONENTS[name]))
    expect(lazyPrimitives, 'these are cheap and should be components, not loaders').toEqual([])
  })

  it('makes one lazy component per loader, however many times a tree asks', () => {
    const entry = KIT_COMPONENTS.DiffPane
    const first = kitComponent(entry)
    expect(first).toBeTypeOf('function')
    // A tree with fifty `DiffLine`s must not mint fifty load states.
    expect(kitComponent(entry)).toBe(first)
  })

  it('hands a component straight back', () => {
    const entry = KIT_COMPONENTS.Button
    expect(kitComponent(entry)).toBe(entry)
  })

  it('reaches nothing under features/ statically', () => {
    // The property the whole split was for, stated directly rather than inferred from the shapes
    // above. This module is in the renderer's modulepreload list on every cold window, because
    // `RemoteTree` is ./Slot.tsx's fallback branch, so one static import of a feature puts that
    // feature in the first paint. This is what the chunk-name denylist in
    // apps/desktop/scripts/check-renderer-budget.mjs catches from the other end, a build later.
    // From the working directory rather than `import.meta.url`: this file runs in the jsdom `hosts`
    // project, where `import.meta.url` is an `http:` URL and `readFileSync` refuses it.
    const source = readFileSync(resolve(process.cwd(), 'src/host/tree/components.ts'), 'utf8')
    const eager = source.split('\n').filter((line) => /^\s*import[^(]*'\.\.\/\.\.\/features\//.test(line))
    expect(eager, 'a feature reached statically from the kit table').toEqual([])
  })

  it('loads every heavy node, so a wrong path is caught here and not in a pane', () => {
    // A loader's specifier is a string the compiler checks for existence and nothing checks for
    // correctness: `m.DiffPane` on a module that renamed the export is `undefined`, and what a reader
    // sees is a tree that draws nothing with no error. So every one is resolved once.
    return Promise.all(HEAVY.map(async (name) => {
      const entry = KIT_COMPONENTS[name]
      if (typeof entry === 'function') throw new Error(`${name} is not a loader`)
      const module = await entry.load()
      expect(module.default, name).toBeTypeOf('function')
    }))
  })
})
