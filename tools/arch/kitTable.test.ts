import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// docs/ui-design.md § Every node at 80 by 24 is the one place the kit's admission rule is actually
// satisfied: a node earns its place only if someone can write what it draws on a host with no pixels,
// and that sentence exists nowhere else. A node added to the kit with no row leaves the rule unmet
// and nothing else notices, because the terminal host that would notice is not built.
//
// Checked by name against the source, the way contributionKinds.test.ts checks its page. The focus
// column is checked too, because it is a second copy of `focusRoles.ts` and a second copy with no
// test is a second copy that goes wrong.

const ROOT = (() => {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir
    const parent = dirname(dir)
    if (parent === dir) throw new Error('Could not locate the workspace root')
    dir = parent
  }
})()

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')

const KIT = 'packages/client-core/src/kit/tokens'

/** Keys of a top-level `const X = { ... }` object, from its declaration. A regex rather than the
 *  TypeScript API, for the reason contributionKinds.test.ts gives: these are two flat object
 *  literals, and the alternative is a compiler dependency to read a list of property names. */
const keysOf = (source: string, name: string): string[] => {
  const start = source.indexOf(`export const ${name} = {`)
  if (start === -1) throw new Error(`${name} not found`)
  const body = source.slice(start, source.indexOf('\n} as const', start))
  return [...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1])
}

const SUPPORT = keysOf(read(`${KIT}/support.ts`), 'NODE_SUPPORT')
const FOCUS = (() => {
  const source = read(`${KIT}/focusRoles.ts`)
  const start = source.indexOf('export const NODE_FOCUS = {')
  const body = source.slice(start, source.indexOf('\n} as const', start))
  return new Map([...body.matchAll(/^ {2}([A-Za-z][A-Za-z0-9]*): '([a-z-]+)'/gm)].map((m) => [m[1], m[2]]))
})()

/** The doc's rows, as `node -> focus`. Every row of every table under the appendix heading looks like
 *  `| \`Node\` | focus | sentence |`, so one shape reads all four tables. */
const DOC = (() => {
  const page = read('docs/ui-design.md')
  const start = page.indexOf('## Every node at 80 by 24')
  if (start === -1) throw new Error('docs/ui-design.md has no § Every node at 80 by 24')
  const body = page.slice(start)
  return new Map(
    [...body.matchAll(/^\| `([A-Za-z][A-Za-z0-9]*)` \| ([a-z-]+) \| (.+?) \|$/gm)].map((m) => [m[1], { focus: m[2], at: m[3] }]),
  )
})()

describe('the 80×24 appendix covers the kit', () => {
  it('every node in the support matrix has a row, and no row names a node that is gone', () => {
    expect([...DOC.keys()].sort()).toEqual([...SUPPORT].sort())
    // Anti-vacuity: a broken regex reads no rows and two empty lists compare equal.
    expect(DOC.size).toBeGreaterThan(60)
  })

  it('every row says what the node draws', () => {
    const empty = [...DOC].filter(([, row]) => row.at.trim().length < 10).map(([node]) => node)
    expect(empty).toEqual([])
  })

  it('every row agrees with focusRoles.ts', () => {
    const wrong = [...DOC]
      .filter(([node, row]) => FOCUS.get(node) !== row.focus)
      .map(([node, row]) => `${node}: doc says ${row.focus}, focusRoles.ts says ${FOCUS.get(node)}`)
    expect(wrong).toEqual([])
  })
})
