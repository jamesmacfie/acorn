import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { readRepoConfigSnapshot, type RepoConfigSnapshotLimits } from './repoConfigSnapshot'

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return { ...actual, fstatSync: vi.fn(actual.fstatSync) }
})

const limits: RepoConfigSnapshotLimits = { fileBytes: 128, totalBytes: 512, files: 4, directoryEntries: 8 }

describe('bounded repository configuration snapshots', () => {
  let dir: string
  let repo: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-snapshot-limits-'))
    repo = join(dir, 'repo')
    mkdirSync(join(repo, '.acorn', 'workflows'), { recursive: true })
  })
  afterEach(() => {
    vi.mocked(fs.fstatSync).mockClear()
    rmSync(dir, { recursive: true, force: true })
  })

  it.each(['config', 'workflow'])('rejects a %s FIFO without waiting for a writer, and refuses other special entries', (kind) => {
    const fifo = kind === 'config' ? join(repo, '.acorn', 'config.toml') : join(repo, '.acorn', 'workflows', 'test.toml')
    execFileSync('mkfifo', [fifo])
    expect(() => readRepoConfigSnapshot(repo, null, limits)).toThrow('regular file')
    rmSync(fifo)
    mkdirSync(fifo)
    expect(() => readRepoConfigSnapshot(repo, null, limits)).toThrow('regular file')
  })

  it('preserves internal links and root aliases while refusing external or dangling links', () => {
    writeFileSync(join(repo, 'config-source'), 'safe bytes')
    const file = join(repo, '.acorn', 'config.toml')
    symlinkSync('../config-source', file)
    const alias = join(dir, 'alias')
    symlinkSync(repo, alias)
    expect(readRepoConfigSnapshot(alias, null, limits)?.files).toEqual([{ path: '.acorn/config.toml', content: 'safe bytes' }])
    rmSync(file)
    writeFileSync(join(dir, 'outside'), 'outside bytes')
    symlinkSync(join(dir, 'outside'), file)
    expect(() => readRepoConfigSnapshot(repo, null, limits)).toThrow('escapes its root')
    rmSync(file)
    symlinkSync(join(dir, 'missing'), file)
    expect(() => readRepoConfigSnapshot(repo, null, limits)).toThrow('unresolved link')
  })

  it('caps individual files and still enforces the read ceiling after an undersized stat', () => {
    writeFileSync(join(repo, '.acorn', 'config.toml'), '123456789')
    expect(() => readRepoConfigSnapshot(repo, null, { ...limits, fileBytes: 8 })).toThrow('byte limit')
    const actual = fs.statSync(join(repo, '.acorn', 'config.toml'))
    vi.mocked(fs.fstatSync).mockReturnValueOnce(Object.assign(Object.create(actual), { size: 0, isFile: () => true }))
    expect(() => readRepoConfigSnapshot(repo, null, { ...limits, fileBytes: 8 })).toThrow('byte limit')
  })

  it('caps formatted aggregate bytes, project executable settings, and file counts', () => {
    writeFileSync(join(repo, '.acorn', 'config.toml'), '1234')
    expect(() => readRepoConfigSnapshot(repo, null, { ...limits, totalBytes: 8 })).toThrow('total byte limit')
    expect(() => readRepoConfigSnapshot(repo, { devScript: 'x'.repeat(129) }, limits)).toThrow('Project executable configuration')
    writeFileSync(join(repo, '.acorn', 'workflows', 'one.toml'), 'one')
    writeFileSync(join(repo, '.acorn', 'workflows', 'two.toml'), 'two')
    expect(() => readRepoConfigSnapshot(repo, null, { ...limits, files: 2 })).toThrow('file limit')
  })

  it('caps directory scans even when entries do not have a TOML suffix', () => {
    writeFileSync(join(repo, '.acorn', 'workflows', 'one.txt'), '')
    writeFileSync(join(repo, '.acorn', 'workflows', 'two.txt'), '')
    expect(() => readRepoConfigSnapshot(repo, null, { ...limits, directoryEntries: 1 })).toThrow('entry limit')
  })
})
