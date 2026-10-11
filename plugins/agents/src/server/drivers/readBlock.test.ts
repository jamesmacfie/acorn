import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'
import { claudeHarness } from './claudeHarness'
import { dataRootReadBlock, sharedGitDir } from './readBlock'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A data root laid out like a real one, with a task worktree linked to a repository outside it.
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'acorn-read-block-')))
  roots.push(root)
  const repo = join(root, 'repo')
  const dataDir = join(root, 'data')
  mkdirSync(repo)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' })
  git('init', '-q')
  git('-c', 'user.email=a@example.com', '-c', 'user.name=A', 'commit', '-q', '--allow-empty', '-m', 'init')
  const worktree = join(dataDir, 'worktrees', 'task-1')
  mkdirSync(join(dataDir, 'worktrees'), { recursive: true })
  git('worktree', 'add', '-q', worktree)
  for (const dir of ['internal-credentials', 'tls', 'agent-skills/session-1/1']) mkdirSync(join(dataDir, dir), { recursive: true })
  for (const file of ['core.sqlite', 'node-keys.sealed', 'internal-credentials/own.token', 'tls/cert.pem']) writeFileSync(join(dataDir, file), '')
  const env = {
    ACORN_API_URL: 'https://127.0.0.1:43123',
    ACORN_API_TOKEN_FILE: join(dataDir, 'internal-credentials', 'own.token'),
    NODE_EXTRA_CA_CERTS: join(dataDir, 'tls', 'cert.pem'),
  }
  return { dataDir, repo, worktree, env, skills: join(dataDir, 'agent-skills', 'session-1', '1') }
}

describe('the data root read block', () => {
  it('finds the shared git folder a linked worktree commits into', () => {
    const { repo, worktree } = fixture()
    expect(realpathSync(sharedGitDir(worktree)!)).toBe(realpathSync(join(repo, '.git')))
    expect(sharedGitDir(repo)).toBeNull()
  })

  it('hides every entry but the ones holding the worktree and skills, and keeps its own token readable', () => {
    const { dataDir, repo, worktree, env, skills } = fixture()
    const block = dataRootReadBlock({ dataDir, worktree, env, skillPaths: [skills] })
    expect(block.dataDir).toBe(dataDir)
    expect(block.hidden.sort()).toEqual(['core.sqlite', 'internal-credentials', 'node-keys.sealed', 'tls'].map((entry) => join(dataDir, entry)))
    expect(block.readable).toEqual(expect.arrayContaining([worktree, skills, env.ACORN_API_TOKEN_FILE, env.NODE_EXTRA_CA_CERTS]))
    expect(block.writable.map((path) => realpathSync(path))).toEqual([realpathSync(join(repo, '.git'))])
    expect(block.loopback).toBe('127.0.0.1:43123')
  })
})

describe('the read block in Claude Code', () => {
  const session = { kind: 'interactive', config: {} } as unknown as AgentSession
  const settings = (meta: Record<string, unknown>) =>
    (meta.claudeCode as { options: { settings: Record<string, unknown> } }).options.settings

  it('turns on a sandbox with no unsandboxed retry, and denies the file tools the hidden entries', () => {
    const block = { dataDir: '/data', readable: ['/data/worktrees/t', '/skills/a'], writable: ['/repo/.git'], hidden: ['/data/core.sqlite'], loopback: '127.0.0.1:43123' }
    expect(settings(claudeHarness.acpSessionMeta!(session, { folders: ['/skills/a'], plugins: [] }, undefined, undefined, block))).toEqual({
      autoContinueAtUsageLimit: false,
      permissions: {
        allow: ['Read(//skills/a/**)'],
        deny: ['Read(//data/core.sqlite)', 'Read(//data/core.sqlite/**)', 'Edit(//data/core.sqlite)', 'Edit(//data/core.sqlite/**)'],
      },
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
        failIfUnavailable: true,
        filesystem: { denyRead: ['/data'], allowRead: block.readable, allowWrite: ['/repo/.git'] },
        network: { allowedDomains: ['127.0.0.1:43123'] },
      },
    })
  })

  it('leaves a session without the block unconfined', () => {
    expect(settings(claudeHarness.acpSessionMeta!(session, { folders: [], plugins: [] }))).toEqual({ autoContinueAtUsageLimit: false })
  })
})
