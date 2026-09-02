import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetWorktreeStatus, invalidateWorktreeStatus, parseWorktreeStatus, worktreeStatus } from './worktreeStatus'
import { removeWorktree } from './worktrees'

// Real git subprocesses, because what is being counted is real git subprocesses.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString()

// Every `git` the seam spawns, counted by subcommand. `server/core/git.ts` runs everything through
// `runProcess`, so counting the spawns means counting what that module actually did.
let spawns: string[] = []
vi.mock('../core/proc', async () => {
  const real = await vi.importActual<typeof import('../core/proc')>('../core/proc')
  return {
    ...real,
    runProcess: (spec: Parameters<typeof real.runProcess>[0]) => {
      spawns.push(`${spec.file} ${spec.args?.[0] ?? ''}`)
      return real.runProcess(spec)
    },
    runProcessOrThrow: (spec: Parameters<typeof real.runProcessOrThrow>[0]) => {
      spawns.push(`${spec.file} ${spec.args?.[0] ?? ''}`)
      return real.runProcessOrThrow(spec)
    },
  }
})

const statuses = () => spawns.filter((s) => s === 'git status').length

describe('the coalesced worktree status read', () => {
  let dir: string
  let checkout: string
  let worktree: string

  beforeEach(() => {
    _resetWorktreeStatus()
    spawns = []
    dir = mkdtempSync(join(tmpdir(), 'acorn-wtstatus-'))
    checkout = join(dir, 'checkout')
    execFileSync('git', ['init', '-q', '-b', 'main', checkout])
    git(checkout, 'config', 'user.email', 't@t.test')
    git(checkout, 'config', 'user.name', 'T')
    writeFileSync(join(checkout, 'a.txt'), '1')
    git(checkout, 'add', '.')
    git(checkout, 'commit', '-q', '-m', 'one')
    worktree = join(dir, 'wt')
    git(checkout, 'worktree', 'add', '-q', '-b', 'feat-x', worktree)
    spawns = []
  })

  afterEach(() => {
    _resetWorktreeStatus()
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs git once for two concurrent callers', async () => {
    const [left, right] = await Promise.all([worktreeStatus(worktree), worktreeStatus(worktree)])
    expect(statuses()).toBe(1)
    expect(left).toEqual(right)
  })

  it('runs git zero times for a caller inside the window', async () => {
    await worktreeStatus(worktree)
    expect(statuses()).toBe(1)
    await worktreeStatus(worktree)
    await worktreeStatus(worktree)
    expect(statuses()).toBe(1)
  })

  it('runs git again once the path has been invalidated', async () => {
    const clean = await worktreeStatus(worktree)
    expect(clean.dirty).toBe(false)

    writeFileSync(join(worktree, 'b.txt'), 'new\n')
    // Not yet: this is the two-second window, and nothing has said the node wrote anything.
    expect((await worktreeStatus(worktree)).dirty).toBe(false)

    invalidateWorktreeStatus(worktree)
    const dirty = await worktreeStatus(worktree)
    expect(dirty.dirty).toBe(true)
    expect(dirty.count).toBe(1)
    expect(statuses()).toBe(2)
  })

  it('never caches a failure, so "we could not tell" cannot become "clean"', async () => {
    const gone = join(dir, 'not-a-worktree')
    expect(await worktreeStatus(gone)).toEqual({ dirty: false, count: 0, branch: null, head: null })
    expect(await worktreeStatus(gone)).toEqual({ dirty: false, count: 0, branch: null, head: null })
    expect(statuses()).toBe(2)
  })

  // The one rule this file exists to protect (docs/future/performance/decisions.md § 4). A cached
  // "clean" reaching `removeWorktree` would delete somebody's uncommitted work, so the guard reads
  // fresh and this is the test that says it does.
  it('still refuses to remove a worktree whose only change was written 100 ms ago', async () => {
    // Warm the cache with the truth as it was: clean.
    expect((await worktreeStatus(worktree)).dirty).toBe(false)

    writeFileSync(join(worktree, 'unsaved-work.txt'), 'a person typed this\n')
    await new Promise((resolve) => setTimeout(resolve, 100))

    const refused = await removeWorktree(checkout, worktree)
    expect(refused).toEqual({ ok: false, reason: 'Worktree has uncommitted changes. Confirm to discard.' })
    // And the read half is still coalesced: the refusal ran git rather than joining the warm entry.
    expect((await worktreeStatus(worktree, { fresh: true })).dirty).toBe(true)

    // Forced still goes through, which is the affordance the dialog offers.
    expect(await removeWorktree(checkout, worktree, true)).toEqual({ ok: true, path: worktree })
  })

  it('does not let a refusal join a read that is already in flight', async () => {
    const { worktreeDirty } = await import('./worktrees')
    const read = worktreeStatus(worktree)
    const refusal = worktreeDirty(worktree)
    await Promise.all([read, refusal])
    // Two spawns for two callers, where two reads would have been one. A refusal never joins.
    expect(statuses()).toBe(2)
  })
})

describe('the porcelain parser', () => {
  it('reads the branch headers and counts only entries', () => {
    expect(parseWorktreeStatus([
      '# branch.oid abc123',
      '# branch.head feat-x',
      '1 .M N... 100644 100644 100644 aaa bbb src/a.ts',
      '? untracked.txt',
    ].join('\n'))).toEqual({ dirty: true, count: 2, branch: 'feat-x', head: 'abc123' })
  })

  it('reports a detached head and an unborn tree as null', () => {
    expect(parseWorktreeStatus('# branch.oid (initial)\n# branch.head (detached)\n'))
      .toEqual({ dirty: false, count: 0, branch: null, head: null })
  })
})
