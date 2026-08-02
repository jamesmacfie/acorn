import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findWorkspaceRoot, resolveDatabasePath, resolveServerPaths } from './serverPaths'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** A miniature workspace: the marker at the root, and two depths node-core code runs from. */
function fixture(): { root: string; sourceModuleDir: string; bundledModuleDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'acorn-server-paths-'))
  roots.push(root)
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"\n')
  const sourceModuleDir = join(root, 'packages/node-core/src/main')
  const bundledModuleDir = join(root, 'apps/desktop/out/main')
  mkdirSync(sourceModuleDir, { recursive: true })
  mkdirSync(bundledModuleDir, { recursive: true })
  return { root, sourceModuleDir, bundledModuleDir }
}

describe('server runtime paths', () => {
  // The point of anchoring on the workspace marker: node-core source and the desktop bundle sit at
  // completely different depths, and neither can be reached from the other by a fixed hop.
  it('finds the same workspace root from source and bundled module depths', () => {
    const { root, sourceModuleDir, bundledModuleDir } = fixture()
    expect(findWorkspaceRoot(sourceModuleDir)).toBe(root)
    expect(findWorkspaceRoot(bundledModuleDir)).toBe(root)
  })

  it('derives the SPA and dev-data paths from the workspace root', () => {
    const { root, sourceModuleDir } = fixture()
    const paths = resolveServerPaths(sourceModuleDir)
    expect(paths).toEqual({
      clientDir: join(root, 'apps/desktop/dist/client'),
      devDataDir: join(root, 'apps/desktop/.acorn'),
    })
    expect(resolveDatabasePath(paths.devDataDir)).toBe(join(root, 'apps/desktop/.acorn', 'acorn.sqlite'))
  })

  // Regression guard: the previous implementation walked for a package.json named "@acorn/desktop",
  // which from packages/node-core matched nothing — dev:node and db:locate threw, and db:migrate
  // quietly created a second database in the wrong package.
  it('resolves identically from anywhere inside the workspace', () => {
    const { root, sourceModuleDir, bundledModuleDir } = fixture()
    const scripts = join(root, 'packages/node-core/scripts')
    mkdirSync(scripts, { recursive: true })
    const seen = [sourceModuleDir, bundledModuleDir, scripts].map((d) => resolveServerPaths(d).devDataDir)
    expect(new Set(seen).size).toBe(1)
  })

  it('fails clearly when invoked outside a workspace', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-server-paths-missing-'))
    roots.push(root)
    expect(() => findWorkspaceRoot(root)).toThrow('Could not locate pnpm-workspace.yaml')
  })
})
