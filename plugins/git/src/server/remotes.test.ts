import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { AutoFetcher } from './autoFetch'
import { RemoteService, validRemoteName, validRemoteUrl } from './remotes'

let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = '' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'acorn-remotes-'))
  const root = join(directory, 'repo'), bare = join(directory, 'remote.git')
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'file'), 'root\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  git(directory, 'init', '-q', '--bare', bare)
  return { root, bare }
}
function core(root: string) {
  return { projects: { byId: async (id: string) => id === 'project' ? { id, path: root } : null },
    repositoryMetadata: { write: async (_: string, action: (repository: string, common: string) => Promise<unknown>) => action(realpathSync(root), realpathSync(resolve(root, git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')))) },
    git: { git: async (args: readonly string[], opts: { cwd: string; env?: Record<string, string> }) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
      const child = spawn('git', [...args], { cwd: opts.cwd, env: { ...process.env, ...opts.env } })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', fail)
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) }, } as unknown as Pick<CoreServices, 'git' | 'projects' | 'repositoryMetadata'>
}

it('accepts explicit transports and rejects executable helper URLs', () => {
  expect(validRemoteName('origin')).toBe(true)
  expect(validRemoteName('-bad')).toBe(false)
  expect(validRemoteUrl('https://github.com/acorn/repo.git')).toBe(true)
  expect(validRemoteUrl('git@github.com:acorn/repo.git')).toBe(true)
  expect(validRemoteUrl('ext::sh -c evil')).toBe(false)
  expect(validRemoteUrl('foo::helper')).toBe(false)
})

it('adds, fetches, edits, and removes an explicit local bare remote with post-state', async () => {
  const { root, bare } = fixture()
  const service = new RemoteService(core(root), () => 1234)
  const added = await service.change('project', { action: 'add', name: 'origin', url: bare })
  expect(added).toMatchObject({ ok: true, roster: { remotes: [{ name: 'origin', fetchUrl: bare }] } })
  git(root, 'push', '-u', 'origin', 'HEAD')
  const fetched = await service.change('project', { action: 'fetch', name: 'origin', expectedUrl: bare })
  expect(fetched.ok).toBe(true)
  expect(fetched.roster.lastFetch.origin?.successAt).toBe(1234)
  expect((await service.change('project', { action: 'remove', name: 'origin', expectedUrl: '/wrong' })).ok).toBe(false)
  const alternate = join(directory, 'alternate.git')
  git(directory, 'init', '-q', '--bare', alternate)
  expect((await service.change('project', { action: 'set-url', name: 'origin', expectedUrl: bare, url: alternate })).roster.remotes[0]?.fetchUrl).toBe(alternate)
  expect((await service.change('project', { action: 'remove', name: 'origin', expectedUrl: alternate })).roster.remotes).toHaveLength(0)
})

it('edits one literal fetch URL without changing push URL and refuses multiple fetch URLs', async () => {
  const { root, bare } = fixture()
  const decorated = join(directory, 'remote[one].git')
  git(directory, 'init', '-q', '--bare', decorated)
  git(root, 'remote', 'add', 'origin', decorated)
  git(root, 'config', 'remote.origin.pushurl', bare)
  const service = new RemoteService(core(root))
  const replacement = join(directory, 'next.git')
  git(directory, 'init', '-q', '--bare', replacement)
  const edited = await service.change('project', { action: 'set-url', name: 'origin', expectedUrl: decorated, url: replacement })
  expect(edited).toMatchObject({ ok: true, roster: { remotes: [{ fetchUrl: replacement, pushUrl: bare, fetchUrlCount: 1, pushUrlCount: 1 }] } })
  git(root, 'config', '--add', 'remote.origin.url', decorated)
  expect((await service.change('project', { action: 'set-url', name: 'origin', expectedUrl: replacement, url: bare })).reason).toContain('multiple fetch URLs')
  expect(git(root, 'config', '--get-all', 'remote.origin.url').split('\n')).toEqual([replacement, decorated])
})

it('refuses a queued metadata write if the project maps to another repository', async () => {
  const { root, bare } = fixture()
  git(root, 'remote', 'add', 'origin', bare)
  const next = join(directory, 'next-repo')
  git(directory, 'clone', '-q', root, next)
  const base = core(root)
  let release!: () => void
  let entered!: () => void
  const queued = new Promise<void>((resolve) => { release = resolve })
  const atQueue = new Promise<void>((resolve) => { entered = resolve })
  let path = root
  const service = new RemoteService({ ...base,
    projects: { byId: async () => ({ id: 'project', path }) },
    repositoryMetadata: { write: async (_: string, action: (repository: string, common: string) => Promise<unknown>) => {
      entered()
      await queued
      return action(realpathSync(path), realpathSync(resolve(path, git(path, 'rev-parse', '--path-format=absolute', '--git-common-dir'))))
    } },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'repositoryMetadata'>)
  const write = service.change('project', { action: 'remove', name: 'origin', expectedUrl: bare })
  await atQueue
  path = next; release()
  expect((await write).reason).toContain('Project repository changed')
  expect(git(root, 'remote')).toBe('origin')
  expect(git(next, 'remote')).toBe('origin')
})

it('auto-fetch moves tracking but cannot make an observed force lease follow another actor', async () => {
  const { root, bare } = fixture()
  git(root, 'remote', 'add', 'origin', bare)
  const branch = git(root, 'branch', '--show-current')
  git(root, 'push', '-u', 'origin', branch)
  const observed = git(root, 'rev-parse', `origin/${branch}`)
  const other = join(directory, 'other')
  git(directory, 'clone', '-q', bare, other)
  git(other, 'config', 'user.name', 'Other Actor')
  git(other, 'config', 'user.email', 'other@acorn.dev')
  writeFileSync(join(other, 'file'), 'advanced remotely\n')
  git(other, 'commit', '-qam', 'Advance remote')
  git(other, 'push', 'origin', branch)
  const advanced = git(other, 'rev-parse', 'HEAD')
  writeFileSync(join(root, 'file'), 'local rewrite\n')
  git(root, 'commit', '-qam', 'Local rewrite')

  const base = core(root)
  const service = new RemoteService(base, () => 5000)
  const fetcher = new AutoFetcher({ ...base,
    projects: { ...base.projects, checkouts: async () => [{ id: 'project', path: root }] },
    identity: { active: () => 'owner' }, prefs: { read: async () => 'true' },
  } as unknown as CoreServices, service, () => 5000)
  expect(await fetcher.tick()).toBe('1 remotes fetched, 0 failed')
  expect(git(root, 'rev-parse', `origin/${branch}`)).toBe(advanced)
  await expect(service.roster('project')).resolves.toMatchObject({ lastFetch: { origin: { successAt: 5000 } } })
  expect(() => git(root, 'push', `--force-with-lease=refs/heads/${branch}:${observed}`, 'origin', `HEAD:refs/heads/${branch}`)).toThrow()
  expect(git(root, 'ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0]).toBe(advanced)
  fetcher.dispose()
})
