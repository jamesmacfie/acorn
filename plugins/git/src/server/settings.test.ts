import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv, CoreServices } from '@acorn/plugin-api/node'
import { AutoFetcher } from './autoFetch'
import { gitSettings, writeIdentity, writeGitPreference, PULL_POLICY_PREF } from './settings'
import { settingsRoutes } from './routes/settings'

let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = '' })
function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'acorn-git-settings-'))
  const root = join(directory, 'repo'), home = join(directory, 'home')
  mkdirSync(root); mkdirSync(home)
  execFileSync('git', ['init', '-q', root])
  return { root, home }
}
function core(root: string, home: string, failEmail: boolean | 'throw-email' | 'readback' = false) {
  const prefs = new Map<string, string>()
  let writes = 0
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig') }
  return { projects: { byId: async () => ({ path: root }) }, prefs: { read: async (_: string, key: string) => prefs.get(key) ?? null,
    write: async (_: string, key: string, value: string) => { prefs.set(key, value) } },
  git: { git: async (args: readonly string[], opts: { cwd: string; stdin?: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
    if (args.includes('--replace-all')) writes++
    if (failEmail === 'readback' && writes > 0 && args.includes('--show-origin')) return fail(new Error('readback unavailable'))
    if (failEmail === 'throw-email' && args.includes('user.email') && args.includes('--replace-all')) return fail(new Error('email subprocess failed'))
    if (failEmail === true && args.includes('user.email') && args.includes('--replace-all')) return done({ code: 1, stdout: '', stderr: 'email write blocked' })
    const child = spawn('git', [...args], { cwd: opts.cwd, env })
    child.stdin.on('error', () => {})
    const stdout: Buffer[] = [], stderr: Buffer[] = []
    child.stdin.end(opts.stdin ?? '')
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
    child.on('error', fail)
    child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
  }) }, } as unknown as Pick<CoreServices, 'git' | 'projects' | 'prefs'>
}

it('reads origins and writes only the explicit repository or isolated Node user scope', async () => {
  const { root, home } = fixture()
  const service = core(root, home)
  let result = await writeIdentity(service, 'project', 'owner', { scope: 'global', name: 'Node Author', email: 'node@example.test' })
  expect(result.name.ok && result.email.ok).toBe(true)
  expect(result.settings.name).toMatchObject({ value: 'Node Author', scope: 'global', global: 'Node Author', local: null })
  result = await writeIdentity(service, 'project', 'owner', { scope: 'local', name: 'Repo Author', email: 'repo@example.test' })
  expect(result.settings.name).toMatchObject({ value: 'Repo Author', scope: 'local', local: 'Repo Author', global: 'Node Author' })
  result = await writeIdentity(service, 'project', 'owner', { scope: 'global', name: 'New Node Author', email: 'new-node@example.test' })
  expect(result.settings.name).toMatchObject({ value: 'Repo Author', scope: 'local', global: 'New Node Author' })
  expect(result.settings.name.origin).toContain('.git/config')
  expect((await writeGitPreference(service, 'project', 'owner', PULL_POLICY_PREF, 'rebase')).pullPolicy).toBe('rebase')
  expect((await gitSettings(service, 'project', 'owner')).autoFetch).toBe(false)
})

it('reads back a partial identity write and leaves the failed field in the caller draft', async () => {
  const { root, home } = fixture()
  const result = await writeIdentity(core(root, home, true), 'project', 'owner', { scope: 'local', name: 'Written', email: 'blocked@example.test' })
  expect(result.name.ok).toBe(true)
  expect(result.email).toEqual({ ok: false, error: 'email write blocked' })
  expect(result.settings.name.local).toBe('Written')
  expect(result.settings.email.value).toBeNull()
})

it('returns first-field success when the second subprocess throws, and keeps original-scope evidence when readback fails', async () => {
  const { root, home } = fixture()
  const failed = await writeIdentity(core(root, home, 'throw-email'), 'project', 'owner', { scope: 'local', name: 'Written', email: 'blocked@example.test' })
  expect(failed.name.ok).toBe(true)
  expect(failed.email).toEqual({ ok: false, error: 'email subprocess failed' })
  expect(failed.settings.name.local).toBe('Written')
  const unread = await writeIdentity(core(root, home, 'readback'), 'project', 'owner', { scope: 'local', name: 'Next', email: 'next@example.test' })
  expect(unread.name.ok && unread.email.ok).toBe(true)
  expect(unread.readbackError).toContain('readback unavailable')
  expect(unread.settings.repository).toBe(realpathSync(root))
  await expect(gitSettings(core(root, home), 'project', 'owner')).resolves.toMatchObject({ name: { local: 'Next' } })
})

it('aborts pending discovery after preference persistence even when readback fails, then permits opt-in', async () => {
  const { root, home } = fixture(), base = core(root, home)
  let failReadback = false, discoveries = 0, remoteReads = 0
  let entered!: () => void, release!: () => void
  const atDiscovery = new Promise<void>((done) => { entered = done })
  const pending = new Promise<void>((done) => { release = done })
  let discoverySignal: AbortSignal | undefined
  const service = { ...base,
    identity: { active: () => 'owner' },
    projects: { ...base.projects, checkouts: async () => [{ id: 'project', path: root }] },
    git: { git: async (args: readonly string[], options: Parameters<typeof base.git.git>[1] & { signal?: AbortSignal }) => {
      if (failReadback && args.includes('--show-origin')) throw new Error('readback unavailable')
      if (args.includes('--git-common-dir')) {
        discoveries++
        if (discoveries === 1) { discoverySignal = options.signal; entered(); await pending; options.signal?.throwIfAborted() }
      }
      return base.git.git(args, options)
    } },
  } as unknown as CoreServices
  const fetcher = new AutoFetcher(service, { roster: async () => { remoteReads++; return { remotes: [] } }, change: async () => ({ ok: true }) } as never)
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => { c.set('principal', { kind: 'device', userId: 'owner' }); await next() })
  app.route('/', settingsRoutes(service, (enabled) => fetcher.setEnabled(enabled)))
  app.onError((error, c) => c.json({ error: error.message }, 503))
  const preference = (value: boolean) => app.request('/projects/project/settings/preference', {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'auto-fetch', value }),
  })
  expect((await preference(true)).status).toBe(200)
  const tick = fetcher.tick()
  await atDiscovery
  failReadback = true
  const disabled = await preference(false)
  expect(disabled.status).toBe(503)
  expect((await disabled.json()).error).toContain('Preference saved, but Git settings readback failed')
  expect(await service.prefs.read('owner', 'git.autoFetch')).toBe('false')
  expect(discoverySignal?.aborted).toBe(true)
  release()
  await tick
  expect(remoteReads).toBe(0)
  failReadback = false
  expect((await preference(true)).status).toBe(200)
  expect(await fetcher.tick()).toContain('0 remotes fetched')
  expect(discoveries).toBe(2)
  fetcher.dispose()
})
