import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The focus model's invariants, where the invariant is a fact about the source rather than about a
// render (docs/tui/reporting.md § The invariants). ./reachability.test.tsx turns the rest of them into
// properties over the pane roster; these three cannot be, because what they forbid is a second place
// to put a decision, a chord nobody can press, and a second writer of where the keys are.

const ROOT = fileURLToPath(new URL('.', import.meta.url))

const filesIn = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => (entry.isDirectory() ? filesIn(join(dir, entry.name)) : [join(dir, entry.name)]))
    .filter((file) => /\.tsx?$/.test(file))

/** Files under a folder of this package that defer work to a microtask, by their path from `src/`. */
const deferring = (folder: string): string[] =>
  filesIn(join(ROOT, folder))
    .filter((file) => /\bqueueMicrotask\s*\(/.test(readFileSync(file, 'utf8')))
    .map((file) => file.slice(ROOT.length))
    .sort()

/** The chord `commandLayer.ts` rewrites away, spelled so this file is not its own counter-example. */
const PLATFORM_PRIMARY = `super${'+'}`

describe('one deferred focus decision', () => {
  it('waits in the landing rule and nowhere else', () => {
    // Deferred focus decisions race each other: two of them run in an order nobody pictured. One pass,
    // at the moment every renderable of a render exists and none of the next one's do, makes the
    // order a list rather than a coincidence.
    expect(deferring('keys')).toEqual(['keys/regions.ts'])
    expect(deferring('kit')).toEqual([])
  })
})

describe('no chord this host cannot press', () => {
  it('spells the platform primary modifier nowhere but the rewrite that removes it', () => {
    // macOS terminal emulators keep Cmd and never deliver it, so a binding spelled with the
    // platform's primary modifier is a binding nobody can press — and it looks right in review, which
    // is why this is a grep rather than a habit (docs/tui/keys.md § Keys and focus).
    // `keys/commandLayer.ts` is the one file allowed to say it, because saying it is how `asCtrl`
    // finds it in a user's own keybinding and rewrites it.
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
    // caret walks below the fold and nothing follows it. A body that can outgrow its frame is a
    // `ScrollViewport` or a `Rows virtual`, and this is a grep because a clip reviews well
    // (docs/tui/scrolling.md § Scrolling viewports).
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
  // Invariant 9, as a fact about the source. "The border is lit and the keys do nothing" is a second
  // owner: the renderer moves focus on its own, the store writes the signal the highlights are drawn
  // from, and the two drift. One owner can't drift, and the only way to keep it to one is to name the
  // files that could hold a second (docs/tui/focus.md § Focus regions).

  /** Every non-test source file of this package, by its path from `src/`. */
  const sources = (): { path: string; text: string }[] =>
    filesIn(ROOT)
      .filter((file) => file !== fileURLToPath(import.meta.url))
      .filter((file) => !/\.test\.tsx?$/.test(file))
      .map((file) => ({ path: file.slice(ROOT.length), text: readFileSync(file, 'utf8') }))

  /** The files that say a pattern at all, by their path from `src/`. */
  const sayers = (pattern: RegExp): string[] =>
    sources()
      .filter(({ text }) => pattern.test(text))
      .map(({ path }) => path)
      .sort()

  it('writes focus and asks the renderer for it in the region store and nowhere else', () => {
    // The signal is the answer, not a view of one: it is what a row draws its caret from and what the
    // keymap engine's host adapter reports as the focused target. The renderer's focus is paint state,
    // mirrored from the store and never read back (./keys/regions.ts § paintCaret). A write, a
    // `focus`, a `blur` or a read of `currentFocusedRenderable` anywhere else is a second owner.
    expect(sayers(/setFocusedNode\(|\.focus\(\)|\.blur\(\)/)).toEqual(['keys/regions.ts'])
    expect(sayers(/currentFocusedRenderable/)).toEqual([])
  })
})

// The painter's own invariant: it is ours, all of it.
//
// The four folders are the tree Solid mutates, the Yoga pass over it, the cell buffer and the input
// parser, and none of them is a wrapper around somebody else's renderer. The keymap engine is a
// dependency of this package, so an import of `@opentui` here would resolve and nothing else would
// notice (docs/tui/keys.md § The adapter).
describe('the new painter is ours', () => {
  it('reaches for nothing from @opentui anywhere under tree, layout, paint or input', () => {
    const borrowed = ['tree', 'layout', 'paint', 'input'].flatMap((folder) =>
      filesIn(join(ROOT, folder))
        .filter((file) => /from '@opentui\//.test(readFileSync(file, 'utf8')))
        .map((file) => file.slice(ROOT.length)),
    )
    expect(borrowed.sort()).toEqual([])
  })
})
