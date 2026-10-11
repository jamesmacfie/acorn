import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'
import { fileToolRefusal } from '@acorn/plugin-api/testkit'
import type { FileGuardPolicy } from '@acorn/plugin-api/node'
import { claudeHarness, claudeReadBlockSettings } from './claudeHarness'
import { dataRootReadBlock, gitWrites, linkedGitDirs } from './readBlock'

const roots: string[] = []
const GUARD = { command: '/app/node', args: ['/app/helper/file-guard.js'] }
// The policy a session's guard hook carries: the last word of its command, single-quoted.
const guardPolicy = (settings: { preToolUse: unknown[] }): FileGuardPolicy => {
  const command = (settings.preToolUse[0] as { hooks: { command: string }[] }).hooks[0]!.command
  return JSON.parse(Buffer.from(command.split(' ').at(-1)!.replace(/'/g, ''), 'base64url').toString('utf8')) as FileGuardPolicy
}
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
  git('worktree', 'add', '-q', join(dataDir, 'worktrees', 'task-2'))
  for (const dir of ['internal-credentials', 'tls', 'agent-skills/session-1/1', 'plugins/linear/skills/triage']) mkdirSync(join(dataDir, dir), { recursive: true })
  for (const file of ['core.sqlite', 'node-keys.sealed', 'internal-credentials/own.token', 'tls/cert.pem', 'plugins/agents.sqlite']) writeFileSync(join(dataDir, file), '')
  const env = {
    ACORN_API_URL: 'https://127.0.0.1:43123',
    ACORN_API_TOKEN_FILE: join(dataDir, 'internal-credentials', 'own.token'),
    NODE_EXTRA_CA_CERTS: join(dataDir, 'tls', 'cert.pem'),
  }
  return { dataDir, repo, worktree, env, skills: join(dataDir, 'agent-skills', 'session-1', '1'), pluginSkill: join(dataDir, 'plugins', 'linear', 'skills', 'triage') }
}

describe('the data root read block', () => {
  it('finds the git folders a linked worktree commits into', () => {
    const { repo, worktree } = fixture()
    const dirs = linkedGitDirs(worktree)!
    expect(realpathSync(dirs.shared)).toBe(realpathSync(join(repo, '.git')))
    expect(realpathSync(dirs.own)).toBe(realpathSync(join(repo, '.git', 'worktrees', 'task-1')))
    expect(linkedGitDirs(repo)).toBeNull()
  })

  it('lets a commit write only objects, refs, logs, and its own git folder, with no wildcards', () => {
    const { repo, worktree } = fixture()
    const { own, shared } = linkedGitDirs(worktree)!
    const other = join(shared, 'worktrees', 'task-2')
    expect(gitWrites(worktree)).toEqual({
      writable: [join(shared, 'objects'), join(shared, 'refs'), join(shared, 'logs'), own],
      writeDenied: [
        join(worktree, '.git'),
        ...['config', 'config.worktree', 'hooks', 'modules'].map((name) => join(shared, name)),
        ...[own, other].flatMap((dir) => ['commondir', 'gitdir', 'config.worktree'].map((name) => join(dir, name))),
      ],
    })
    // A plain `.git` folder is denied whole, because a rename of it can't be stopped otherwise. Linux's
    // sandbox skips a write entry with a wildcard.
    const plain = gitWrites(repo)
    expect(plain).toEqual({ writable: [], writeDenied: [join(repo, '.git')] })
    for (const path of [...plain.writeDenied, ...gitWrites(worktree).writeDenied]) expect(path).not.toMatch(/[*?[]/)
  })

  it('hides everything beside the worktree and skills, however deep they sit, and keeps its own token readable', () => {
    const { dataDir, repo, worktree, env, skills, pluginSkill } = fixture()
    const block = dataRootReadBlock({ dataDir, worktree, env, skillPaths: [skills, pluginSkill], fileGuard: GUARD })
    expect(block).toMatchObject({ dataDir, worktree, fileGuard: GUARD })
    // Another task's worktree and the plugin databases beside a plugin's skill folder are hidden too.
    expect(block.hidden.sort()).toEqual(['core.sqlite', 'internal-credentials', 'node-keys.sealed', 'plugins/agents.sqlite', 'tls', 'worktrees/task-2']
      .map((entry) => join(dataDir, entry)))
    expect(block.readable).toEqual(expect.arrayContaining([worktree, skills, env.ACORN_API_TOKEN_FILE, env.NODE_EXTRA_CA_CERTS]))
    expect(block).toMatchObject(gitWrites(worktree))
    expect(block.readable.map((path) => realpathSync(path))).toContain(realpathSync(join(repo, '.git')))
    expect(block.loopback).toBe('127.0.0.1:43123')
  })

  // A penetration review found that the deny rules, built from the entries present at the start, had
  // nothing for a file created later, and Claude's file tools run outside its sandbox.
  it('keeps the file tools out of a protected file created after the session started', () => {
    const { dataDir, repo, worktree, env, skills, pluginSkill } = fixture()
    const settings = claudeReadBlockSettings(dataRootReadBlock({ dataDir, worktree, env, skillPaths: [skills, pluginSkill], fileGuard: GUARD }))
    writeFileSync(join(dataDir, '.env'), 'SECRET=fake')
    expect(settings.deny.some((rule) => rule.includes('.env'))).toBe(false)
    const policy = guardPolicy(settings)
    const call = (tool_name: string, tool_input: Record<string, unknown>) => fileToolRefusal(policy, { tool_name, tool_input, cwd: worktree })
    expect(call('Read', { file_path: join(dataDir, '.env') })).toMatch(/data folder/)
    expect(call('Write', { file_path: join(dataDir, '.env'), content: 'x' })).toMatch(/data folder/)
    // A destination that doesn't exist yet, and one reached through a link in the worktree.
    expect(call('Write', { file_path: join(dataDir, 'tls', 'key.pem'), content: 'x' })).toMatch(/data folder/)
    symlinkSync(dataDir, join(worktree, 'data-alias'))
    expect(call('Edit', { file_path: join(worktree, 'data-alias', '.env'), old_string: 'a', new_string: 'b' })).toMatch(/data folder/)
    expect(call('Grep', { pattern: 'SECRET', path: dirname(dataDir) })).toMatch(/would include/)
    expect(call('Write', { file_path: join(worktree, '.git'), content: 'gitdir: /tmp' })).toMatch(/git file/)
    // What the session works in still works, and so does its own skill.
    expect(call('Write', { file_path: join(worktree, 'src', 'new.ts'), content: 'x' })).toBeNull()
    expect(call('Read', { file_path: join(skills, 'SKILL.md') })).toBeNull()
    expect(call('Grep', { pattern: 'x' })).toBeNull()
    expect(call('Read', { file_path: join(repo, 'README.md') })).toBeNull()
  })
})

describe('the read block in Claude Code', () => {
  const session = { kind: 'interactive', config: {} } as unknown as AgentSession
  const settings = (meta: Record<string, unknown>) =>
    (meta.claudeCode as { options: { settings: Record<string, unknown> } }).options.settings

  it('turns on a sandbox with no unsandboxed retry, and denies the file tools the hidden entries', () => {
    const block = { dataDir: '/data', worktree: '/data/worktrees/t', readable: ['/data/worktrees/t', '/skills/a'], writable: ['/repo/.git'], writeDenied: ['/repo/.git/hooks'], hidden: ['/data/core.sqlite'], loopback: '127.0.0.1:43123', fileGuard: GUARD }
    const bridge = { command: '/app/node', args: ['/app/helper/loop-hook.js'], beforeTool: true, afterTool: false }
    const meta = settings(claudeHarness.acpSessionMeta!(session, { folders: ['/skills/a'], plugins: [] }, bridge, undefined, block))
    // The guard runs before the loop hook bridge, for the file tools only.
    const hooks = meta.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    expect(hooks.PreToolUse.map((entry) => entry.matcher)).toEqual(['Read|NotebookRead|LS|Glob|Grep|Write|Edit|MultiEdit|NotebookEdit', '*'])
    expect(hooks.PreToolUse[0]!.hooks[0]!.command).toMatch(/^'\/app\/node' '\/app\/helper\/file-guard\.js' '[A-Za-z0-9_-]+'$/)
    expect(guardPolicy(claudeReadBlockSettings(block))).toEqual({
      dataDir: ['/data'], read: block.readable, write: ['/data/worktrees/t', '/repo/.git'], writeDenied: ['/repo/.git/hooks'],
    })
    expect({ ...meta, hooks: undefined }).toEqual({
      hooks: undefined,
      autoContinueAtUsageLimit: false,
      permissions: {
        allow: ['Read(//skills/a/**)'],
        deny: ['Read(//data/core.sqlite)', 'Read(//data/core.sqlite/**)', 'Edit(//data/core.sqlite)', 'Edit(//data/core.sqlite/**)'],
      },
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
        failIfUnavailable: true,
        filesystem: { denyRead: ['/data'], allowRead: block.readable, allowWrite: ['/repo/.git'], denyWrite: ['/repo/.git/hooks'] },
        network: { allowedDomains: ['127.0.0.1:43123'] },
      },
    })
  })

  it('leaves a session without the block unconfined', () => {
    expect(settings(claudeHarness.acpSessionMeta!(session, { folders: [], plugins: [] }))).toEqual({ autoContinueAtUsageLimit: false })
  })
})
