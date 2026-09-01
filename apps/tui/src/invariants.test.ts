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
