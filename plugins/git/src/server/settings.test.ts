import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { gitSettings, writeIdentity, writeGitPreference, PULL_POLICY_PREF } from './settings'

let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = '' })
function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'acorn-git-settings-'))
  const root = join(directory, 'repo'), home = join(directory, 'home')
  mkdirSync(root); mkdirSync(home)
  execFileSync('git', ['init', '-q', root])
  return { root, home }
}
function core(root: string, home: string, failEmail = false) {
  const prefs = new Map<string, string>()
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, 'xdg'), GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig') }
  return { projects: { byId: async () => ({ path: root }) }, prefs: { read: async (_: string, key: string) => prefs.get(key) ?? null,
    write: async (_: string, key: string, value: string) => { prefs.set(key, value) } },
  git: { git: async (args: readonly string[], opts: { cwd: string; stdin?: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
    if (failEmail && args.includes('user.email') && args.includes('--replace-all')) return done({ code: 1, stdout: '', stderr: 'email write blocked' })
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
