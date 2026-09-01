import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The focus model's invariants, where the invariant is a fact about the source rather than about a
// render (docs/tui.md § Focus regions). Phase 6 of docs/future/terminal-updates/ turns the rest of
// them into properties over the pane roster; this one cannot be one, because what it forbids is a
// second place to put a decision.

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
  it('waits in the settle pass and nowhere else', () => {
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
