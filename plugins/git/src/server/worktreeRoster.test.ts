import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { Hono } from 'hono'
import type { AppEnv, CoreServices, TaskRef } from '@acorn/plugin-api/node'
import { cleanup } from './cleanup'
import { inventory, parseRoster } from './worktreeRoster'
import { worktreeRoutes } from './routes/worktrees'

let folder = ''
afterEach(() => {
  if (folder) rmSync(folder, { recursive: true, force: true })
  folder = ''
})
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' })

function fixture() {
  folder = mkdtempSync(join(tmpdir(), 'acorn-git-worktrees-'))
  const root = join(folder, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'initial.txt'), 'one\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Initial')
  const clean = join(folder, 'clean tree')
  const dirty = join(folder, 'dirty\ntree')
  git(root, 'worktree', 'add', '-qb', 'clean', clean)
  git(root, 'worktree', 'add', '-qb', 'dirty', dirty)
  writeFileSync(join(dirty, 'changed\tfile.txt'), 'dirty\n')
  return { root: realpathSync(root), clean: realpathSync(clean), dirty: realpathSync(dirty) }
}

function core(root: string, tasks: TaskRef[] = [], aliasPath = root) {
  const projects = [
    { id: 'project', name: 'First', path: root, workspaceId: 'workspace', github: null },
    { id: 'alias', name: 'Alias', path: aliasPath, workspaceId: 'workspace', github: null },
  ]
  return {
    projects: { byId: async (id: string) => projects.find((project) => project.id === id) ?? null },
    tasks: { branchClaims: async () => tasks },
    git: {
      git: async (args: readonly string[], opts: { cwd: string }) => {
        const result = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
          const child = spawn('git', [...args], { cwd: opts.cwd })
          const stdout: Buffer[] = [],
            stderr: Buffer[] = []
          child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
          child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
          child.on('close', (code) =>
            done({
              code: code ?? 1,
              stdout: Buffer.concat(stdout).toString(),
              stderr: Buffer.concat(stderr).toString(),
            }),
          )
        })
        return result
      },
    },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks'>
}

it('reads NUL-delimited branch, detached, locked, missing, dirty and aliased worktrees', async () => {
  const { root, clean, dirty } = fixture()
  const detached = join(folder, 'detached')
  git(root, 'worktree', 'add', '-q', '--detach', detached)
  const detachedGitPath = realpathSync(detached)
  git(root, 'worktree', 'lock', clean)
  rmSync(detached, { recursive: true })
  const service = core(
    root,
    [
      {
        id: 'task',
        title: 'Owned',
        projectId: 'project',
        branch: 'clean',
        worktreePath: clean,
        skipSetup: false,
        pullNumber: null,
      },
      {
        id: 'folder-task',
        title: 'Folder task',
        projectId: 'project',
        branch: null,
        worktreePath: null,
        skipSetup: false,
        pullNumber: null,
      },
    ],
    clean,
  )
  const first = await inventory(service, 'project')
  const alias = await inventory(service, 'alias')
  expect(first.repository).toBe(alias.repository)
  expect(first.worktrees.map((entry) => entry.id)).toEqual(alias.worktrees.map((entry) => entry.id))
  expect(first.worktrees.map((entry) => entry.observation)).toEqual(alias.worktrees.map((entry) => entry.observation))
  expect(first.worktrees).toHaveLength(4)
  expect(first.worktrees.find((item) => item.main)).toMatchObject({ path: root, owners: [{ id: 'folder-task' }] })
  expect(first.worktrees.find((item) => item.path === clean)).toMatchObject({
    locked: true,
    dirty: false,
    owners: [{ id: 'task' }],
  })
  expect(first.worktrees.find((item) => item.path === dirty)).toMatchObject({
    dirty: true,
    changedFiles: ['changed\tfile.txt'],
  })
  expect(first.worktrees.find((item) => item.path === detachedGitPath)).toMatchObject({ branch: null, missing: true })
  expect((await cleanup(service, 'project', first.worktrees.find((item) => item.main)!.observation)).error).toMatch(
    /main checkout/,
  )
  expect(
    (await cleanup(service, 'project', first.worktrees.find((item) => item.path === clean)!.observation)).error,
  ).toMatch(/locked/)
})

it('removes a clean unowned tree, and refuses ownership that appears after the read', async () => {
  const { root, clean, dirty } = fixture()
  const owners: TaskRef[] = []
  const service = core(root, owners, clean)
  const original = await inventory(service, 'project')
  const dirtyId = original.worktrees.find((item) => item.path === dirty)!.observation
  expect((await cleanup(service, 'project', dirtyId)).ok).toBe(false)
  const cleanId = original.worktrees.find((item) => item.path === clean)!.observation
  owners.push({
    id: 'new',
    title: 'New owner',
    projectId: 'project',
    branch: 'clean',
    worktreePath: clean,
    skipSetup: false,
    pullNumber: null,
  })
  expect((await cleanup(service, 'project', cleanId)).error).toMatch(/belongs to New owner/)
  expect((await cleanup(service, 'alias', cleanId)).error).toMatch(/belongs to New owner/)
  owners.pop()
  expect((await cleanup(service, 'project', cleanId)).ok).toBe(true)
  expect((await inventory(service, 'project')).worktrees.some((item) => item.path === clean)).toBe(false)
})

it('parses worktree paths containing newlines without splitting entries', () => {
  expect(parseRoster('worktree /tmp/a\nb\0HEAD abc\0detached\0\0')).toMatchObject([{ path: '/tmp/a\nb', branch: null }])
})

it('blocks repository-wide prune while any missing registration belongs to a task', async () => {
  const { root, clean, dirty } = fixture()
  rmSync(clean, { recursive: true })
  rmSync(dirty, { recursive: true })
  const owners: TaskRef[] = [
    {
      id: 'owned',
      title: 'Missing owner',
      projectId: 'project',
      branch: 'dirty',
      worktreePath: dirty,
      skipSetup: false,
      pullNumber: null,
    },
  ]
  const service = core(root, owners)
  const before = await inventory(service, 'project')
  const cleanId = before.worktrees.find((entry) => entry.path === clean)?.observation
  expect(cleanId).toBeTruthy()
  expect((await cleanup(service, 'project', cleanId!)).error).toMatch(/protected worktree registration/)
  expect((await inventory(service, 'project')).worktrees).toHaveLength(3)
})

it('prunes a fresh missing registration after checking every affected entry', async () => {
  const { root, clean } = fixture()
  rmSync(clean, { recursive: true })
  const service = core(root)
  const before = await inventory(service, 'project')
  const target = before.worktrees.find((entry) => entry.path === clean)!
  expect(target).toMatchObject({ missing: true, prunable: true })
  const result = await cleanup(service, 'project', target.observation)
  expect(result).toMatchObject({ ok: true })
  expect(result.inventory.worktrees.some((entry) => entry.id === target.id)).toBe(false)
  expect((await inventory(service, 'project')).worktrees.some((entry) => entry.id === target.id)).toBe(false)
})

it('keeps a stable worktree id but refuses a stale observation after HEAD moves', async () => {
  const { root, clean } = fixture()
  const service = core(root)
  const before = (await inventory(service, 'project')).worktrees.find((entry) => entry.path === clean)!
  writeFileSync(join(clean, 'next.txt'), 'next\n')
  git(clean, 'add', 'next.txt')
  git(clean, 'commit', '-qm', 'Move HEAD')
  const after = (await inventory(service, 'project')).worktrees.find((entry) => entry.path === clean)!
  expect(after.id).toBe(before.id)
  expect(after.observation).not.toBe(before.observation)
  expect((await cleanup(service, 'project', before.observation)).error).toMatch(/changed/)
  expect((await inventory(service, 'project')).worktrees.some((entry) => entry.id === before.id)).toBe(true)
})

it('gates inventory and cleanup to paired devices and rejects arbitrary observations', async () => {
  const { root, clean } = fixture()
  const service = core(root)
  const device = new Hono<AppEnv>()
  device.use('*', async (c, next) => {
    c.set('principal', { kind: 'device', userId: 'person' })
    await next()
  })
  device.route('/api', worktreeRoutes(service))
  const task = new Hono<AppEnv>()
  task.use('*', async (c, next) => {
    c.set('principal', { kind: 'internal', userId: 'person', scope: 'task', taskId: 'a' })
    await next()
  })
  task.route('/api', worktreeRoutes(service))
  const path = '/api/projects/project/worktrees'
  expect((await task.request(path)).status).toBe(403)
  expect((await task.request(`${path}/${'a'.repeat(64)}/remove`, { method: 'POST' })).status).toBe(403)
  expect((await device.request(`${path}/not-a-hash/remove`, { method: 'POST' })).status).toBe(400)
  const before = await device.request(path)
  expect(before.status).toBe(200)
  const rows = (await before.json()) as Awaited<ReturnType<typeof inventory>>
  const observation = rows.worktrees.find((entry) => entry.path === clean)?.observation
  expect(observation).toBeTruthy()
  const result = await device.request(`${path}/${observation}/remove`, { method: 'POST' })
  expect((await result.json()) as { ok: boolean }).toMatchObject({ ok: true })
})
