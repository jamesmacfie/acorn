import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// docs/contribution-kinds.md is the one page an author can see whole, and its whole value is being
// complete (architecture review finding 5, plugin surface review finding 4). A kind added to the
// manifest schema or to a plugin context with no row here makes the page a partial list, which is
// worse than no list: a reader who trusts it concludes the kind does not exist.
//
// Checked by name against the source rather than by a committed count, because a count tells you
// something changed and not what.

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
const TABLE = read('docs/contribution-kinds.md')

/** The members of a `ctx` type, from its declaration. A regex rather than the TypeScript API: this is
 *  one shallow object literal in each file, and the alternative is a compiler dependency in the arch
 *  suite to read twelve property names. */
const members = (source: string, typeName: string): string[] => {
  const body = new RegExp(`export type ${typeName} = \\{(.*?)\\n\\}`, 's').exec(source)
  if (!body) throw new Error(`Could not find ${typeName}`)
  return [...body[1].matchAll(/^ {2}(?:readonly )?([a-zA-Z]+)[?]?:/gm)].map((match) => match[1]!)
}

describe('the contribution-kind table is complete', () => {
  it('names every manifest contribution kind', () => {
    const contract = read('packages/protocol/src/pluginContract.ts')
    const shape = /const contributionsShape = z\.looseObject\(\{(.*?)\n\}\)/s.exec(contract)![1]!
    const kinds = [...shape.matchAll(/^ {2}([a-zA-Z]+):/gm)].map((match) => match[1]!)
    expect(kinds.length).toBeGreaterThan(15) // anti-vacuity: the regex still finds the schema
    expect(kinds.filter((kind) => !TABLE.includes(`contributions.${kind}`))).toEqual([])
  })

  it('names every client context member', () => {
    const client = members(read('packages/client-core/src/registries/plugin.ts'), 'ClientPluginContext')
    expect(client.length).toBeGreaterThan(15)
    expect(client.filter((name) => name !== 'name' && !TABLE.includes(`ctx.${name}`))).toEqual([])
  })

  it('names every node context member', () => {
    const node = members(read('packages/node-core/src/server/pluginHost/types.ts'), 'NodePluginContext')
    expect(node.length).toBeGreaterThan(8)
    expect(node.filter((name) => name !== 'name' && !TABLE.includes(`ctx.${name}`))).toEqual([])
  })

  it('records a direction for every single-tier row', () => {
    // A row whose tier is not "Both" has to say what happens to it. The check is on the row text, so a
    // new compiled-only kind cannot be added without answering the question.
    const rows = TABLE.split('\n').filter((line) => line.startsWith('| ') && /\| (Compiled|Loaded) \|/.test(line))
    expect(rows.length).toBeGreaterThan(5)
    expect(rows.filter((row) => !row.includes('**Direction:'))).toEqual([])
  })
})
