import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppDatabase } from '../../../core/server/db'
import { LocalGitService } from './localGitService'

// Spawns git subprocesses; the default 5s timeout is too tight under the parallel suite. Kept to two
// `it` blocks (one repo setup each) to bound the git load this file adds.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })

// taskRoot is mocked so this tests the git logic against a real repo without the worktree machinery.
let repoRoot: string | null = null
vi.mock('../../../core/main/taskWorktree', () => ({
  taskRoot: async () => repoRoot,
}))

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-C', cwd, ...args], { stdio: 'pipe' }).toString()

describe('LocalGitService', () => {
  let dir: string
  let svc: LocalGitService

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-gitsvc-'))
    execFileSync('git', ['init', '-b', 'main', dir], { stdio: 'pipe' })
    git(dir, 'config', 'user.email', 't@acorn.test')
    git(dir, 'config', 'user.name', 'Test')
    git(dir, 'config', 'commit.gpgsign', 'false')
    writeFileSync(join(dir, 'a.txt'), 'hello\n')
    git(dir, 'add', 'a.txt')
    git(dir, 'commit', '-m', 'init')
    repoRoot = dir
    svc = new LocalGitService({} as AppDatabase)
  })
  afterEach(() => {
    repoRoot = null
    rmSync(dir, { recursive: true, force: true })
  })

  it('runs the status → stage → diff → commit → blob → discard flow against a real repo', async () => {
    // status with branch + modification
    writeFileSync(join(dir, 'a.txt'), 'hello world\n')
    let status = await svc.status('t')
    expect(status.branch).toBe('main')
    expect(status.changes).toEqual([expect.objectContaining({ path: 'a.txt', status: 'modified', staged: false })])

    // stage + staged diff
    expect(await svc.stage('t', { selection: 'all' })).toEqual({ changed: true })
    expect((await svc.diff('t', 'a.txt', 'staged')).patch).toContain('hello world')

    // commit returns a sha; tree clean after
    const { commitSha, summary } = await svc.commit('t', { message: 'update a' })
    expect(commitSha).toMatch(/^[0-9a-f]{40}$/)
    expect(summary).toBe('update a')
    expect((await svc.status('t')).changes).toHaveLength(0)

    // blob at HEAD
    expect((await svc.blob('t', 'a.txt')).text).toBe('hello world\n')

    // discard restores a fresh modification
    writeFileSync(join(dir, 'a.txt'), 'dirty\n')
    expect(await svc.discard('t', { selection: 'paths', paths: [{ path: 'a.txt', untracked: false }] })).toEqual({ changed: true })
    status = await svc.status('t')
    expect(status.changes).toHaveLength(0)
  })

  it('rejects a task without a worktree with a 409, and maps a failed push to a typed error', async () => {
    repoRoot = null
    await expect(svc.status('t')).rejects.toMatchObject({ code: 'conflict', status: 409 })
    repoRoot = dir
    await expect(svc.push('t')).rejects.toMatchObject({ status: expect.any(Number) })
  })
})
