import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { compileCacheDir } from './compileCache'

// Node never removes an entry, and every build renames the service's chunks, so without the prune
// the cache grows by a build's worth on every update.
describe('compile cache directory', () => {
  const dirs: string[] = []
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })
  const scratch = (): { root: string; entry: string } => {
    const dir = mkdtempSync(join(tmpdir(), 'compile-cache-'))
    dirs.push(dir)
    const entry = join(dir, 'service.js')
    writeFileSync(entry, 'import "./chunks/crash-aaaa.js"\n')
    return { root: join(dir, 'cache'), entry }
  }

  it('keeps one build: the same entry reuses its directory, a new one removes the old', () => {
    const { root, entry } = scratch()
    const first = compileCacheDir(root, entry)!
    expect(dirname(first)).toBe(root)
    expect(compileCacheDir(root, entry)).toBe(first)

    mkdirSync(join(first, 'v24.11.0-arm64'), { recursive: true })
    writeFileSync(join(first, 'v24.11.0-arm64', 'entry'), 'code')
    expect(compileCacheDir(root, entry)).toBe(first)
    expect(existsSync(join(first, 'v24.11.0-arm64', 'entry'))).toBe(true)

    writeFileSync(entry, 'import "./chunks/crash-bbbb.js"\n')
    const second = compileCacheDir(root, entry)!
    expect(second).not.toBe(first)
    expect(readdirSync(root)).toEqual([])
  })

  it('gives up on the cache, not the start, when the entry cannot be read', () => {
    const { root, entry } = scratch()
    expect(compileCacheDir(root, `${entry}.missing`)).toBeUndefined()
  })
})
