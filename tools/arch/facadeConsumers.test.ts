import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { ROOT } from './docAnchors'
import { facadeConsumers } from './facadeConsumers'

// The `@acorn/plugin-api` facade offers plugins a seam each name is for. A name nobody imports is no
// seam, and nothing else notices one losing its last caller: knip skips the facade, and its surface
// snapshot records names, not callers. See docs/plugins/plugin-api.md § The plugin API.
//
// The closed kit is the one exception. Its nodes are offered to every plugin whether or not one draws
// with them yet, and `support.test.ts` in client-core holds that list to the support matrix instead.

const SUPPORT = readFileSync(join(ROOT, 'packages/client-core/src/kit/tokens/support.ts'), 'utf8')
const KIT_NODES = new Set(
  [...SUPPORT.slice(SUPPORT.indexOf('export const NODE_SUPPORT = {')).matchAll(/^ {2}([A-Z]\w*):/gm)].map((m) => m[1]),
)
const isKitNode = (name: string): boolean => {
  const [entry, member] = name.split(': ')
  return (entry === 'ui' || entry === 'ui/tree') && KIT_NODES.has(member!)
}

it('every facade export has an importer outside the facade', () => {
  const consumers = facadeConsumers()
  // Anti-vacuity: an import pattern that stopped matching would leave every name with no importer, and
  // a snapshot that stopped parsing would leave no names at all.
  expect(consumers.size).toBeGreaterThan(500)
  expect(consumers.get('node: NodePlugin')?.size).toBeGreaterThan(5)
  expect(KIT_NODES.size).toBeGreaterThan(40)

  const unused = [...consumers].filter(([name, users]) => users.size === 0 && !isKitNode(name)).map(([name]) => name)
  expect(unused, 'delete these from the facade, or import them where they are meant to be used').toEqual([])
})
