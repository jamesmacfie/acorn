import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import { directoryBytes, listProcesses, parseProcessTable, processTreeBytes } from './footprint'

describe('the process table', () => {
  it('reads `ps -A -o pid=,ppid=,rss=` with its padding, RSS in KiB', () => {
    expect(parseProcessTable('    1     0  1024\n  512     1   20\n\n garbage line\n')).toEqual([
      { pid: 1, ppid: 0, rssBytes: 1024 * 1024 },
      { pid: 512, ppid: 1, rssBytes: 20 * 1024 },
    ])
  })

  it.skipIf(process.platform === 'win32')('finds this test process in the real table', async () => {
    const ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    try {
      const rows = await listProcesses(ctx.core.proc)
      const self = rows?.find((row) => row.pid === process.pid)
      expect(self?.ppid).toBe(process.ppid)
      expect(self?.rssBytes).toBeGreaterThan(0)
    } finally {
      ctx.cleanup()
    }
  })

  it('sums each root and its descendants once, and skips a root that has exited', () => {
    const rows = [
      { pid: 10, ppid: 1, rssBytes: 100 },
      { pid: 11, ppid: 10, rssBytes: 10 },
      { pid: 12, ppid: 11, rssBytes: 1 },
      { pid: 20, ppid: 1, rssBytes: 1000 },
    ]
    expect(processTreeBytes(rows, [10])).toBe(111)
    // A root listed twice, or one inside another's tree, is not counted twice.
    expect(processTreeBytes(rows, [10, 11, 10])).toBe(111)
    expect(processTreeBytes(rows, [99])).toBe(0)
  })
})

describe('directoryBytes', () => {
  it('adds up nested files and answers 0 for a folder that does not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'acorn-footprint-'))
    try {
      mkdirSync(join(root, 'ab'))
      writeFileSync(join(root, 'ab', 'one'), Buffer.alloc(300))
      writeFileSync(join(root, 'two'), Buffer.alloc(200))
      expect(await directoryBytes(root)).toBe(500)
      expect(await directoryBytes(join(root, 'missing'))).toBe(0)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
