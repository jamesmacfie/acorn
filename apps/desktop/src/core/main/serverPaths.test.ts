import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { findDesktopRoot, resolveServerPaths } from './serverPaths'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): { root: string; sourceModuleDir: string; bundledModuleDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'acorn-server-paths-'))
  roots.push(root)
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: '@acorn/desktop' }))
  const sourceModuleDir = join(root, 'src/core/main')
  const bundledModuleDir = join(root, 'out/main')
  mkdirSync(sourceModuleDir, { recursive: true })
  mkdirSync(bundledModuleDir, { recursive: true })
  return { root, sourceModuleDir, bundledModuleDir }
}

describe('server runtime paths', () => {
  it('finds the same desktop package root from source and bundled module depths', () => {
    const { root, sourceModuleDir, bundledModuleDir } = fixture()
    expect(findDesktopRoot(sourceModuleDir)).toBe(root)
    expect(findDesktopRoot(bundledModuleDir)).toBe(root)
  })

  it('derives the SPA and dev-data paths from the package root', () => {
    const { root, sourceModuleDir } = fixture()
    expect(resolveServerPaths(sourceModuleDir)).toEqual({
      clientDir: join(root, 'dist/client'),
      devDataDir: join(root, '.acorn'),
    })
  })

  it('fails clearly when invoked outside the desktop package', () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-server-paths-missing-'))
    roots.push(root)
    expect(() => findDesktopRoot(root)).toThrow("Could not locate the @acorn/desktop package root")
  })
})
