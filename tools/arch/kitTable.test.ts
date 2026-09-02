import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// docs/ui-design.md § Every node at 80 by 24 is the one place the kit's admission rule is actually
// satisfied: a node earns its place only if someone can write what it draws on a host with no pixels,
// and that sentence exists nowhere else. A node added to the kit with no row leaves the rule unmet,
// and the terminal host draws whatever it likes without anybody having decided what it should be.
//
// Checked by name against the source, the way contributionKinds.test.ts checks its page. The focus
// column is checked too, because it is a second copy of `focusRoles.ts` and a second copy with no
// test is a second copy that goes wrong.
//
// And, since the terminal host started drawing the kit, both component tables are checked against the
// same list. A node cannot join with a sentence and no component, or with a component on one host and
// nothing on the other: the two hosts draw the same kit or the kit is not closed.

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

/** The keys of a host's `KIT_COMPONENTS`. Entries are comma-separated and either shorthand (`Stack`),
 *  a rename onto a compound half (`ModalBody: Modal.Body`), or a loader (`DiffPane: load(() => …)`),
 *  so the name is what stands before the first colon. That is also why a loader is written on one line
 *  with no comma in it. Read as text for the reason above: importing either table pulls in a
 *  renderer. */
const componentKeys = (path: string): string[] => {
  const source = read(path)
  const start = source.indexOf('KIT_COMPONENTS: KitTable = {')
  if (start === -1) throw new Error(`${path} has no KIT_COMPONENTS`)
  const body = source
    .slice(source.indexOf('{', start) + 1, source.indexOf('\n}', start))
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  return body
    .split(',')
    .map((entry) => entry.split(':')[0].trim())
    .filter((name) => /^[A-Z][A-Za-z0-9]*$/.test(name))
}

const HOST_TABLES = {
  dom: componentKeys('packages/client-core/src/host/tree/components.ts'),
  tui: componentKeys('apps/tui/src/kit/components.tsx'),
}
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

  it('both hosts draw every node in the matrix, and nothing else', () => {
    for (const [host, names] of Object.entries(HOST_TABLES)) {
      // Anti-vacuity, per host: a regex that stopped matching would agree with an empty matrix.
      expect(names.length, `${host} table read`).toBeGreaterThan(60)
      expect([...new Set(names)].sort(), `${host} table`).toEqual([...SUPPORT].sort())
    }
  })

  it('every row agrees with focusRoles.ts', () => {
    const wrong = [...DOC]
      .filter(([node, row]) => FOCUS.get(node) !== row.focus)
      .map(([node, row]) => `${node}: doc says ${row.focus}, focusRoles.ts says ${FOCUS.get(node)}`)
    expect(wrong).toEqual([])
  })
})
