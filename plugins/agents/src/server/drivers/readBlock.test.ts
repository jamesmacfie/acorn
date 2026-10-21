import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, sep } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSession } from '../../contract/wire.ts'
import { fileToolRefusal } from '@acorn/plugin-api/testkit'
import { toolOutputDir, type FileGuardPolicy } from '@acorn/plugin-api/node'
import { claudeHarness, claudeReadBlockSettings } from './claudeHarness'
import { dataRootReadBlock, gitWrites, linkedGitDirs } from './readBlock'

const roots: string[] = []
const within = (path: string, root: string): boolean => path === root || path.startsWith(root + sep)
const GUARD = { command: '/app/node', args: ['/app/helper/file-guard.js'] }
// The policy a session's guard hook carries: the last word of its command, single-quoted.
const guardPolicy = (settings: { preToolUse: unknown[] }): FileGuardPolicy => {
  const command = (settings.preToolUse[0] as { hooks: { command: string }[] }).hooks[0]!.command
  return JSON.parse(
    Buffer.from(command.split(' ').at(-1)!.replace(/'/g, ''), 'base64url').toString('utf8'),
  ) as FileGuardPolicy
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
  for (const dir of [
    'internal-credentials',
    'tls',
    'agent-skills/session-1/1',
    'plugins/linear/skills/triage',
    'agent-objects',
    'agent-session-files/session-1',
    'agent-session-files/session-2',
  ])
    mkdirSync(join(dataDir, dir), { recursive: true })
  for (const file of [
    'core.sqlite',
    'node-keys.sealed',
    'internal-credentials/own.token',
    'tls/cert.pem',
    'plugins/agents.sqlite',
  ])
    writeFileSync(join(dataDir, file), '')
  const env = {
    ACORN_API_URL: 'https://127.0.0.1:43123',
    ACORN_API_TOKEN_FILE: join(dataDir, 'internal-credentials', 'own.token'),
    NODE_EXTRA_CA_CERTS: join(dataDir, 'tls', 'cert.pem'),
  }
  return {
    dataDir,
    repo,
    worktree,
    env,
    skills: join(dataDir, 'agent-skills', 'session-1', '1'),
    pluginSkill: join(dataDir, 'plugins', 'linear', 'skills', 'triage'),
    attachments: join(dataDir, 'agent-session-files', 'session-1'),
  }
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

  it('hides everything beside the worktree, skills, and own attachments, however deep they sit, and keeps its own token readable', () => {
    const { dataDir, repo, worktree, env, skills, pluginSkill, attachments } = fixture()
    const block = dataRootReadBlock({
      dataDir,
      clientDirs: [],
      worktree,
      env,
      skillPaths: [skills, pluginSkill],
      attachments,
      fileGuard: GUARD,
    })
    expect(block).toMatchObject({ dataDir, worktree, fileGuard: GUARD })
    // Another task's worktree, the plugin databases beside a plugin's skill folder, the attachment store,
    // and another session's attachments are hidden too.
    expect(block.hidden.sort()).toEqual(
      [
        'agent-objects',
        'agent-session-files/session-2',
        'core.sqlite',
        'internal-credentials',
        'node-keys.sealed',
        'plugins/agents.sqlite',
        'tls',
        'worktrees/task-2',
      ].map((entry) => join(dataDir, entry)),
    )
    expect(block.readable).toEqual(
      expect.arrayContaining([worktree, skills, attachments, env.ACORN_API_TOKEN_FILE, env.NODE_EXTRA_CA_CERTS]),
    )
    expect(block).toMatchObject(gitWrites(worktree))
    expect(block.readable.map((path) => realpathSync(path))).toContain(realpathSync(join(repo, '.git')))
    expect(block.loopback).toBe('127.0.0.1:43123')
  })

  // Deny rules built from the entries present at the start have nothing for a file created later, and
  // Claude's file tools run outside its sandbox.
  it('keeps the file tools out of a protected file created after the session started', () => {
    const { dataDir, repo, worktree, env, skills, pluginSkill, attachments } = fixture()
    const settings = claudeReadBlockSettings(
      dataRootReadBlock({
        dataDir,
        clientDirs: [],
        worktree,
        env,
        skillPaths: [skills, pluginSkill],
        attachments,
        fileGuard: GUARD,
      }),
    )
    writeFileSync(join(dataDir, '.env'), 'SECRET=fake')
    expect(settings.deny.some((rule) => rule.includes('.env'))).toBe(false)
    const policy = guardPolicy(settings)
    const call = (tool_name: string, tool_input: Record<string, unknown>) =>
      fileToolRefusal(policy, { tool_name, tool_input, cwd: worktree })
    expect(call('Read', { file_path: join(dataDir, '.env') })).toMatch(/data folder/)
    expect(call('Write', { file_path: join(dataDir, '.env'), content: 'x' })).toMatch(/data folder/)
    // A destination that doesn't exist yet, and one reached through a link in the worktree.
    expect(call('Write', { file_path: join(dataDir, 'tls', 'key.pem'), content: 'x' })).toMatch(/data folder/)
    symlinkSync(dataDir, join(worktree, 'data-alias'))
    expect(call('Edit', { file_path: join(worktree, 'data-alias', '.env'), old_string: 'a', new_string: 'b' })).toMatch(
      /data folder/,
    )
    expect(call('Grep', { pattern: 'SECRET', path: dirname(dataDir) })).toMatch(/would include/)
    expect(call('Write', { file_path: join(worktree, '.git'), content: 'gitdir: /tmp' })).toMatch(/git file/)
    // What the session works in still works, and so does its own skill.
    expect(call('Write', { file_path: join(worktree, 'src', 'new.ts'), content: 'x' })).toBeNull()
    expect(call('Read', { file_path: join(skills, 'SKILL.md') })).toBeNull()
    // An attachment copied in after the start, and not another session's.
    writeFileSync(join(attachments, 'spec.pdf'), '%PDF-1.7')
    expect(call('Read', { file_path: join(attachments, 'spec.pdf') })).toBeNull()
    expect(call('Read', { file_path: join(dataDir, 'agent-session-files', 'session-2', 'spec.pdf') })).toMatch(
      /data folder/,
    )
    expect(call('Grep', { pattern: 'x' })).toBeNull()
    expect(call('Read', { file_path: join(repo, 'README.md') })).toBeNull()
  })

  // The CLI and the other clients keep the owner's device token there as a plain file.
  it('blocks the client folders like the data root, and only the entries beside the work in one holding it', () => {
    const { dataDir, worktree, env, skills, attachments } = fixture()
    // An installed desktop's custody root holds the data root, with its key and paired Nodes beside it.
    const root = dirname(dataDir)
    writeFileSync(join(root, 'data.key'), 'key')
    const client = join(root, 'acorn')
    mkdirSync(join(client, 'mobile'), { recursive: true })
    writeFileSync(join(client, 'device-token-local'), 'owner')
    // A development desktop's custody root, beside its Node's data root.
    const shell = `${dataDir}-shell`
    mkdirSync(shell)
    writeFileSync(join(shell, 'data.key'), 'key')
    const missing = join(root, 'missing')
    const block = dataRootReadBlock({
      dataDir,
      clientDirs: [client, shell, root, missing],
      worktree,
      env,
      skillPaths: [skills],
      attachments,
      fileGuard: GUARD,
    })
    expect(block.clientDirs).toEqual([client, shell, root, missing])
    // The sandbox never denies a folder above the worktree or the data root.
    expect(block.clientReadDenied).toContain(join(root, 'data.key'))
    expect(block.clientReadDenied).toEqual(expect.arrayContaining([client, shell]))
    for (const path of block.clientReadDenied) {
      expect(within(worktree, path) || within(dataDir, path)).toBe(false)
      expect(path).not.toBe(missing)
    }
    expect(block.hidden).toEqual(
      expect.arrayContaining([join(client, 'device-token-local'), join(shell, 'data.key'), join(root, 'data.key')]),
    )
    expect(new Set(block.hidden).size).toBe(block.hidden.length)

    const settings = claudeReadBlockSettings(block)
    expect((settings.sandbox.filesystem as { denyRead: string[] }).denyRead).toEqual([
      dataDir,
      ...block.clientReadDenied,
    ])
    expect(settings.deny).toEqual(
      expect.arrayContaining([`Read(/${join(client, 'device-token-local')})`, `Edit(/${join(client, 'mobile')}/**)`]),
    )
    const policy = guardPolicy(settings)
    expect(policy.dataDir).toEqual([dataDir, client, shell, root, missing])
    const call = (tool_name: string, tool_input: Record<string, unknown>) =>
      fileToolRefusal(policy, { tool_name, tool_input, cwd: worktree })
    expect(call('Read', { file_path: join(client, 'device-token-local') })).toMatch(/data folder/)
    expect(call('Read', { file_path: join(root, 'data.key') })).toMatch(/data folder/)
    expect(call('Read', { file_path: join(shell, 'data.key') })).toMatch(/data folder/)
    // Created after the start, so no deny rule names them.
    expect(call('Read', { file_path: join(client, 'fleet.json') })).toMatch(/data folder/)
    expect(call('Read', { file_path: join(missing, 'device-token-local') })).toMatch(/data folder/)
    // The work inside the desktop's folder still works.
    expect(call('Read', { file_path: join(worktree, 'README.md') })).toBeNull()
    expect(call('Write', { file_path: join(worktree, 'src', 'new.ts'), content: 'x' })).toBeNull()
    expect(call('Read', { file_path: join(skills, 'SKILL.md') })).toBeNull()
    expect(call('Grep', { pattern: 'x' })).toBeNull()
  })
})

describe('the read block in Claude Code', () => {
  const session = { kind: 'interactive', taskId: 't1', config: {} } as unknown as AgentSession
  const settings = (meta: Record<string, unknown>) =>
    (meta.claudeCode as { options: { settings: Record<string, unknown> } }).options.settings

  it('turns on a sandbox with no unsandboxed retry, and denies the file tools the hidden entries', () => {
    const block = {
      dataDir: '/data',
      clientDirs: ['/config/acorn', '/config/missing'],
      clientReadDenied: ['/config/acorn'],
      worktree: '/data/worktrees/t',
      readable: ['/data/worktrees/t', '/skills/a'],
      writable: ['/repo/.git'],
      writeDenied: ['/repo/.git/hooks'],
      hidden: ['/data/core.sqlite'],
      loopback: '127.0.0.1:43123',
      fileGuard: GUARD,
    }
    const bridge = { command: '/app/node', args: ['/app/helper/loop-hook.js'], beforeTool: true, afterTool: false }
    const meta = settings(
      claudeHarness.acpSessionMeta!(session, { folders: ['/skills/a'], plugins: [] }, bridge, undefined, block),
    )
    // The guard runs before the loop hook bridge, for the file tools only.
    const hooks = meta.hooks as { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }
    expect(hooks.PreToolUse.map((entry) => entry.matcher)).toEqual([
      'Read|NotebookRead|LS|Glob|Grep|Write|Edit|MultiEdit|NotebookEdit',
      '*',
    ])
    expect(hooks.PreToolUse[0]!.hooks[0]!.command).toMatch(
      /^'\/app\/node' '\/app\/helper\/file-guard\.js' '[A-Za-z0-9_-]+'$/,
    )
    expect(guardPolicy(claudeReadBlockSettings(block))).toEqual({
      dataDir: ['/data', '/config/acorn', '/config/missing'],
      read: block.readable,
      write: ['/data/worktrees/t', '/repo/.git'],
      writeDenied: ['/repo/.git/hooks'],
    })
    expect({ ...meta, hooks: undefined }).toEqual({
      hooks: undefined,
      autoContinueAtUsageLimit: false,
      permissions: {
        allow: ['Read(//skills/a/**)', `Read(/${toolOutputDir('t1')}/**)`],
        deny: [
          'Read(//data/core.sqlite)',
          'Read(//data/core.sqlite/**)',
          'Edit(//data/core.sqlite)',
          'Edit(//data/core.sqlite/**)',
        ],
      },
      sandbox: {
        enabled: true,
        allowUnsandboxedCommands: false,
        failIfUnavailable: true,
        filesystem: {
          denyRead: ['/data', '/config/acorn'],
          allowRead: block.readable,
          allowWrite: ['/repo/.git'],
          denyWrite: ['/repo/.git/hooks'],
        },
        network: { allowedDomains: ['127.0.0.1:43123'] },
      },
    })
  })

  it('leaves a session without the block unconfined', () => {
    expect(settings(claudeHarness.acpSessionMeta!(session, { folders: [], plugins: [] }))).toEqual({
      autoContinueAtUsageLimit: false,
      permissions: { allow: [`Read(/${toolOutputDir('t1')}/**)`] },
    })
  })
})
