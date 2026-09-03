import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The focus model's invariants, where the invariant is a fact about the source rather than about a
// render (docs/tui.md § The invariants). ../reachability.test.tsx turns the rest of them into
// properties over the pane roster; these three cannot be, because what they forbid is a second place
// to put a decision, a chord nobody can press, and a second writer of where the keys are.

const ROOT = fileURLToPath(new URL('.', import.meta.url))

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (
    entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)]
  )).filter((file) => /\.tsx?$/.test(file))

/** Files under a folder of this package that defer work to a microtask, by their path from `src/`. */
const deferring = (folder: string): string[] => filesIn(join(ROOT, folder))
  .filter((file) => /\bqueueMicrotask\s*\(/.test(readFileSync(file, 'utf8')))
  .map((file) => file.slice(ROOT.length))
  .sort()

/** The chord `commandLayer.ts` rewrites away, spelled so this file is not its own counter-example. */
const PLATFORM_PRIMARY = `super${'+'}`

describe('one deferred focus decision', () => {
  it('waits in the landing rule and nowhere else', () => {
    // Six of these raced each other, and the class of bug was always the same: two of them ran in an
    // order the author had not pictured. One pass, at the moment every renderable of a render exists
    // and none of the next one's do, makes the order a list rather than a coincidence.
    expect(deferring('keys')).toEqual(['keys/regions.ts'])
    expect(deferring('kit')).toEqual([])
    const store = readFileSync(join(ROOT, 'keys/regions.ts'), 'utf8')
    expect(store.match(/\bqueueMicrotask\s*\(/g)).toHaveLength(1)
  })
})

describe('no chord this host cannot press', () => {
  it('spells the platform primary modifier nowhere but the rewrite that removes it', () => {
    // macOS terminal emulators keep Cmd and never deliver it, so a binding spelled with the
    // platform's primary modifier is a binding nobody can press — and it looks right in review, which
    // is why this is a grep rather than a habit. The `tabs` layout and the key splits both shipped
    // with one (docs/tui.md § Keys and focus). `keys/commandLayer.ts` is the one file allowed to say
    // it, because saying it is how `asCtrl` finds it in a user's own keybinding and rewrites it.
    const said = filesIn(ROOT)
      .filter((file) => file !== fileURLToPath(import.meta.url))
      .filter((file) => readFileSync(file, 'utf8').includes(PLATFORM_PRIMARY))
      .map((file) => file.slice(ROOT.length))
      .sort()
    expect(said).toEqual(['keys/commandLayer.ts'])
  })
})

describe('a scroll is a scrollbox and not a clip', () => {
  it('spells overflow="scroll" in the viewport seam and nowhere else', () => {
    // `overflow="scroll"` is a yoga clipping instruction and nothing more: it hides what will not fit
    // and there is no offset for anything to move. It looks like a scroll right up to the moment the
    // caret walks below the fold and nothing follows it, which is what eight of the nine plugin lists
    // did. A body that can outgrow its frame is a `ScrollViewport` or a `Rows virtual`, and this is a
    // grep because a clip reviews well (docs/tui.md § Scrolling viewports).
    //
    // Tests may say it. `kit/markdown.test.tsx` puts a clip round a document on purpose, to assert
    // what the markdown pass drew rather than what a viewport did with it.
    const said = filesIn(ROOT)
      .filter((file) => file !== fileURLToPath(import.meta.url))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .filter((file) => /overflow=["']scroll["']|overflow=\{[^}]*['"]scroll['"]/.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length))
      .sort()
    expect(said).toEqual(['kit/scrolling.tsx'])
  })
})

describe('the store is the only owner of focus', () => {
  // Invariant 9, as a fact about the source. Every "the border is lit and the keys do nothing" bug in
  // this app was a second owner: the renderer moved focus on its own, the store wrote the signal the
  // highlights are drawn from, and the two drifted. One owner cannot drift, and the only way to keep
  // it to one is to count the places that could be a second (docs/tui.md § Focus regions).

  /** Every non-test source file of this package, by its path from `src/`. */
  const sources = (): { path: string; text: string }[] => filesIn(ROOT)
    .filter((file) => file !== fileURLToPath(import.meta.url))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .map((file) => ({ path: file.slice(ROOT.length), text: readFileSync(file, 'utf8') }))

  /** How many times a pattern is said, file by file, leaving out the files that never say it. */
  const said = (pattern: RegExp): Record<string, number> => Object.fromEntries(
    sources()
      .map(({ path, text }) => [path, (text.match(pattern) ?? []).length] as const)
      .filter(([, count]) => count > 0)
      .sort(([a], [b]) => a.localeCompare(b)),
  )

  it('writes the focus signal in one function and nowhere else', () => {
    // The signal is the answer, not a view of one: it is what a row draws its caret from and what the
    // keymap engine's host adapter reports as the focused target. Written anywhere but the one writer
    // it is a claim nothing else agrees with.
    expect(said(/setFocusedNode\(/g)).toEqual({ 'keys/regions.ts': 1 })
    const store = readFileSync(join(ROOT, 'keys/regions.ts'), 'utf8')
    const writer = store.slice(store.indexOf('const setFocus ='), store.indexOf('// \u2500\u2500 Clicks are hit tests'))
    expect(writer).toContain('setFocusedNode(')
  })

  it('tells the renderer where the keys are in the caret mirror and nowhere else', () => {
    // The renderer's focus is paint state now: an edit buffer draws no caret unless the renderer has
    // focused it, so the store mirrors its own answer there once and never reads it back. A `focus`
    // or `blur` anywhere else is a second owner, and reading `currentFocusedRenderable` anywhere is
    // asking the renderer a question the store answers (./keys/regions.ts § paintCaret).
    expect(said(/\.focus\(\)/g)).toEqual({ 'keys/regions.ts': 1 })
    expect(said(/\.blur\(\)/g)).toEqual({ 'keys/regions.ts': 1 })
    expect(said(/currentFocusedRenderable/g)).toEqual({})
    const store = readFileSync(join(ROOT, 'keys/regions.ts'), 'utf8')
    const mirror = store.slice(store.indexOf('const paintCaret ='))
    expect(mirror.slice(0, mirror.indexOf('\n}'))).toContain('.focus()')
  })

  it('declares which nodes are focusable at mount, and in these places only', () => {
    // The flag is the store's own declaration of what can hold the keys: `reachable` reads it, the
    // reading-order walk reads it, and the caret mirror needs it still set on the node it paints. So
    // it is a declaration made where a node is built — a `ref`, `pressable`, which a `ref` calls, or,
    // in the region store, a region's frame at registration and a scope's box at the push, each of
    // which is the last resort of a walk into it. Another write is a new answer to "who decides what
    // is reachable", and it belongs in the region store or nowhere.
    //
    // `tree/compat.ts` is the sixth and it is a node being built rather than a sixth opinion: the
    // accessor there gives a `scrollbox`, an `input` and a `textarea` the defaults OpenTUI's own
    // renderables had, and phase 4 deletes the file
    // (docs/future/terminal-rewrite/phase-2-the-painter.md).
    expect(said(/focusable = /g)).toEqual({
      'keys/regions.ts': 2,
      'keys/stops.ts': 2,
      'kit/grouping.tsx': 1,
      'kit/rectangle.tsx': 2,
      'kit/showing.tsx': 2,
      'tree/compat.ts': 1,
    })
  })
})

// The new painter's own invariant: it is ours, all of it.
//
// The four folders are the tree Solid mutates, the Yoga pass over it, the cell buffer and the input
// parser, and the whole point of the programme is that none of them is a wrapper around somebody
// else's renderer. An import that crept back in would be a dependency phase 4 could not delete and a
// runtime floor it could not lower, and it would not fail anything else: the package still has
// `@opentui/core` in it, so the import would resolve and the tests would pass
// (docs/future/terminal-rewrite/phase-2-the-painter.md § Done when).
describe('the new painter is ours', () => {
  it('reaches for nothing from @opentui anywhere under tree, layout, paint or input', () => {
    const borrowed = ['tree', 'layout', 'paint', 'input'].flatMap((folder) => filesIn(join(ROOT, folder))
      .filter((file) => /from '@opentui\//.test(readFileSync(file, 'utf8')))
      .map((file) => file.slice(ROOT.length)))
    expect(borrowed.sort()).toEqual([])
  })
})
