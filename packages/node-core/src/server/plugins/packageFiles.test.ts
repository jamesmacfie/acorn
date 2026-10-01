import { execFileSync, spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { hashPluginFile, pluginDirectoryEntries, readPluginFile, streamPluginFile, visitPluginFile } from './packageFiles'
import { assertPluginPackageTree, PLUGIN_TREE_LIMITS } from './packageTree'

let root: string
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'acorn-package-files-')) })
afterEach(() => { rmSync(root, { recursive: true, force: true }) })

it('reads and hashes confined regular aliases, refusing missing/outside/directory entries', () => {
  writeFileSync(join(root, 'file'), 'hello')
  symlinkSync('file', join(root, 'alias'))
  symlinkSync('../outside', join(root, 'broken'))
  expect(readPluginFile(root, 'alias', 5).toString()).toBe('hello')
  expect(hashPluginFile(root, 'alias', 5)).toBe(hashPluginFile(root, 'file', 5))
  expect(() => readPluginFile(root, '.', 5)).toThrow(/regular/)
  expect(() => readPluginFile(root, 'broken', 5)).toThrow()
  const outside = join(root, '..', `${root.split('/').pop()}-outside`)
  try {
    writeFileSync(outside, 'outside')
    symlinkSync(outside, join(root, 'escape'))
    expect(() => readPluginFile(root, 'escape', 5)).toThrow(/escapes/)
  } finally { rmSync(outside, { force: true }) }
})
it('bounds declared and actual bytes when a file grows after the descriptor check', () => {
  writeFileSync(join(root, 'file'), 'hello')
  expect(() => readPluginFile(root, 'file', 4)).toThrow(/limit/)
  expect(() => visitPluginFile(root, 'file', 5, (fd, stats) => {
    appendFileSync(join(root, 'file'), '!')
    streamPluginFile(fd, stats.size, 5, () => undefined)
  })).toThrow(/while reading/)
})
it.skipIf(process.platform === 'win32')('refuses a FIFO immediately in a killable child', () => {
  execFileSync('/usr/bin/mkfifo', [join(root, 'pipe')])
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { readPluginFile } from ${JSON.stringify(new URL('./packageFiles.ts', import.meta.url).href)};
    try { readPluginFile(${JSON.stringify(root)}, 'pipe', 8); process.exitCode = 2 }
    catch (error) { if (!error.message.includes('regular')) throw error }
  `], { timeout: 2000, maxBuffer: 4096 })
  expect(result.error).toBeUndefined()
  expect(result.status, result.stderr.toString()).toBe(0)
})
it('bounds local folder depth, count and bytes while preserving safe internal aliases', () => {
  mkdirSync(join(root, 'a/b'), { recursive: true })
  writeFileSync(join(root, 'a/b/file'), 'tiny')
  symlinkSync('a/b/file', join(root, 'alias'))
  expect(() => assertPluginPackageTree(root)).not.toThrow()
  expect(() => assertPluginPackageTree(root, { ...PLUGIN_TREE_LIMITS, depth: 1 })).toThrow(/levels/)
  expect(() => assertPluginPackageTree(root, { ...PLUGIN_TREE_LIMITS, entries: 2 })).toThrow(/entries/)
  expect(() => assertPluginPackageTree(root, { ...PLUGIN_TREE_LIMITS, fileBytes: 3 })).toThrow(/byte limits/)
})

it('caps directory collection before fingerprint sorting', () => {
  for (const name of ['c', 'a', 'b']) writeFileSync(join(root, name), '')
  expect(() => pluginDirectoryEntries(root, 2)).toThrow(/entry limit/)
  expect(pluginDirectoryEntries(root, 3).map((entry) => entry.name).sort()).toEqual(['a', 'b', 'c'])
})
