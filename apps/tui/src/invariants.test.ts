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

describe('the renderer is the only truth about focus', () => {
  // Invariant 9, as a fact about the source. Every "the border is lit and the keys do nothing" bug in
  // this app was a second writer: one place moved the renderer's focus, another wrote the signal the
  // highlights are drawn from, and the two drifted. One writer cannot drift, and the only way to keep
  // it to one is to count them (docs/tui.md § Focus regions).

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

  it('writes the focus signal in the renderer event listener and nowhere else', () => {
    // The signal is what a row draws its caret from. Written anywhere but the listener, it is a claim
    // about focus that the renderer never made, which is a caret on a node that answers no keys.
    expect(said(/setFocusedNode\(/g)).toEqual({ 'keys/regions.ts': 1 })
    const store = readFileSync(join(ROOT, 'keys/regions.ts'), 'utf8')
    const writer = store.slice(store.indexOf('const writeFocus ='), store.indexOf('export function installRegions'))
    expect(writer).toContain('setFocusedNode(')
  })

  it('asks the renderer to move focus in one function', () => {
    // `focusRenderable` is that function, and it reports what the renderer did rather than what it
    // was asked for. A `focus` call anywhere else is a move the store never hears about, because the
    // store hears about moves through the renderer's event.
    expect(said(/\.focus\(\)/g)).toEqual({ 'keys/regions.ts': 1 })
    const store = readFileSync(join(ROOT, 'keys/regions.ts'), 'utf8')
    const door = store.slice(store.indexOf('export function focusRenderable'))
    expect(door.slice(0, door.indexOf('\n}'))).toContain('.focus()')
  })

  it('declares which nodes are focusable at mount, and in these places only', () => {
    // `blur()` refuses a node that is not focusable, so flipping the flag off a node that holds the
    // keys wedges them there for the rest of the run, which is what a disabled control used to do.
    // The flag is therefore a declaration made where a node is built: a `ref`, `pressable`, which a
    // `ref` calls, or, in the region store, a region's frame at registration and a scope's box at the
    // push, each of which is the last resort of a walk into it. Another write is a new answer to
    // "who decides what is reachable", and it belongs in the region store or nowhere.
    expect(said(/focusable = /g)).toEqual({
      'keys/regions.ts': 2,
      'keys/stops.ts': 2,
      'kit/grouping.tsx': 1,
      'kit/rectangle.tsx': 2,
      'kit/showing.tsx': 2,
    })
  })
})
