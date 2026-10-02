import { execFileSync } from 'node:child_process'
import { lstatSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { invalidateWorktreeStatus } from '@acorn/plugin-api/node'
import { localStatus } from './localDiff'

let outstanding = 0
let peak = 0
let calls = 0
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>()
  return {
    ...real,
    lstat: async (...args: Parameters<typeof real.lstat>) => {
      calls++
      peak = Math.max(peak, ++outstanding)
      try { return await real.lstat(...args) }
      finally { outstanding-- }
    },
  }
})
let dir: string
afterEach(() => {
  invalidateWorktreeStatus()
  if (dir) rmSync(dir, { recursive: true, force: true })
})

it('bounds fresh stamps for 3,000 files and four readers while preserving exact keys, order, and counts', async () => {
  dir = mkdtempSync(join(tmpdir(), 'acorn-stamp-admission-'))
  execFileSync('git', ['init', '-q', '-b', 'main', dir])
  const names = Array.from({ length: 3_000 }, (_, i) => `file-${String(i).padStart(5, '0')}.txt`)
  for (const name of names) writeFileSync(join(dir, name), 'fixture\n')
  const expected = names.map((name) => {
    const stat = lstatSync(join(dir, name))
    return { path: name, status: 'untracked', staged: false, additions: null, deletions: null,
      contentKey: `${stat.mode} ${stat.size} ${stat.mtimeMs} ${stat.ctimeMs}` }
  })
  for (const readers of [1, 1, 4]) {
    peak = calls = outstanding = 0
    const statuses = await Promise.all(Array.from({ length: readers }, () => localStatus(dir)))
    expect(calls).toBe(readers * 3_003)
    // Eight stamps per reader plus at most one operation marker check per reader.
    expect(peak).toBeLessThanOrEqual(readers * 9)
    expect(outstanding).toBe(0)
    for (const status of statuses) expect(status.changes).toEqual(expected)
  }
})
