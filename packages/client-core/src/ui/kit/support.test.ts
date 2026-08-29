import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workspaceRoot } from '../../styles/readStyleSheets'
import { NODE_SUPPORT } from './support'

// The kit is closed, and this is what closes it: the node set a plugin can reach and the support
// matrix have to be the same list. See docs/ui-design.md § The closed kit.
//
// Read from the barrel's text rather than imported, because client-core cannot import the package
// that re-exports it, and because the contract is the barrel file people edit.
const BARREL = join(workspaceRoot(), 'packages/plugin-api/src/ui/index.ts')

/** Component exports: every value re-exported under a capitalised name. Helpers and hooks start
 *  lowercase, and type-only clauses are skipped whole. */
function exportedComponents(source: string): string[] {
  const names: string[] = []
  for (const clause of source.matchAll(/\bexport\s+(type\s+)?\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    if (clause[1]) continue
    for (const raw of clause[2].split(',')) {
      const entry = raw.trim()
      if (!entry || entry.startsWith('type ')) continue
      const parts = entry.split(/\s+as\s+/)
      const name = parts[parts.length - 1].trim()
      if (/^[A-Z]/.test(name)) names.push(name)
    }
  }
  return names
}

describe('the kit support matrix', () => {
  const barrel = exportedComponents(readFileSync(BARREL, 'utf8'))

  it('reads the barrel it is checked against', () => {
    // Anti-vacuity: a parser that stopped matching would agree with an empty matrix.
    expect(barrel.length).toBeGreaterThan(40)
    expect(barrel).toContain('Button')
  })

  it('gives every exported node a row', () => {
    expect(barrel.filter((name) => !(name in NODE_SUPPORT)).sort()).toEqual([])
  })

  it('names a node in every row', () => {
    expect(Object.keys(NODE_SUPPORT).filter((name) => !barrel.includes(name)).sort()).toEqual([])
  })

  it('answers for the terminal in every row, even though nothing reads it yet', () => {
    const levels = new Set(['full', 'reduced', 'fallback', 'absent'])
    const missing = Object.entries(NODE_SUPPORT)
      .filter(([, row]) => !levels.has(row.tui) || !levels.has(row.dom))
      .map(([node]) => node)
    expect(missing).toEqual([])
  })
})
