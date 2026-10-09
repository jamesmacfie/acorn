import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { beginTaskArchive, finishTaskArchive, makeTestCoreServices, makeTestDb, schema } from '@acorn/plugin-api/testkit'
import { changeRef, refRoster } from './refs'

let directory = ''
afterEach(() => { if (directory) rmSync(directory, { recursive: true, force: true }); directory = '' })
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
function fixture() {
  directory = mkdtempSync(join(tmpdir(), 'acorn-refs-'))
  const root = join(directory, 'repo')
  mkdirSync(root)
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Acorn Test')
  git(root, 'config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'file'), 'root\n')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'Root')
  return root
}
function core(root: string, tasks: { id: string; title: string; projectId: string; branch: string; worktreePath: null }[] = []) {
  return {
    projects: { byId: async (id: string) => ['a', 'b'].includes(id) ? { id, path: root } : null },
    tasks: { branchClaims: async () => tasks },
    repositoryMetadata: { write: async (_: string, action: (repository: string, common: string) => Promise<unknown>) => action(realpathSync(root), realpathSync(resolve(root, git(root, 'rev-parse', '--path-format=absolute', '--git-common-dir')))) },
    git: { git: async (args: readonly string[], opts: { cwd: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
      const child = spawn('git', [...args], { cwd: opts.cwd })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', fail)
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks' | 'repositoryMetadata'>
}

it('protects checked-out and task-reserved branches across project aliases', async () => {
  const root = fixture()
  const id = git(root, 'rev-parse', 'HEAD')
  const branch = git(root, 'branch', '--show-current')
  git(root, 'branch', 'reserved', id)
  const service = core(root, [{ id: 'task', title: 'Pending task', projectId: 'b', branch: 'reserved', worktreePath: null }])
  const roster = await refRoster(service, 'a')
  expect(roster.refs.find((ref) => ref.name === branch)?.checkedOut).toBe(true)
  expect(roster.refs.find((ref) => ref.name === 'reserved')?.reservedBy[0]?.id).toBe('task')
  expect((await changeRef(service, 'a', { action: 'delete-branch', name: 'reserved', expectedId: id })).reason).toContain('Pending task')
  expect((await changeRef(service, 'a', { action: 'rename-branch', name: branch, expectedId: id, nextName: 'renamed' })).reason).toContain('checked out')
  expect(git(root, 'branch', '--list', 'reserved')).toBe('reserved')
})

it('creates and deletes both kinds of tags, and refuses a stale ref and invalid name', async () => {
  const root = fixture()
  const id = git(root, 'rev-parse', 'HEAD')
  const service = core(root)
  expect((await changeRef(service, 'a', { action: 'create-tag', name: 'v1', startId: id, message: null })).ok).toBe(true)
  expect((await changeRef(service, 'a', { action: 'create-tag', name: 'v2', startId: id, message: 'Release' })).ok).toBe(true)
  const refs = (await refRoster(service, 'a')).refs
  expect(refs.find((ref) => ref.name === 'v1')?.objectId).toBe(id)
  expect(refs.find((ref) => ref.name === 'v2')?.objectId).not.toBe(id)
  expect(refs.find((ref) => ref.name === 'v2')?.commitId).toBe(id)
  expect((await changeRef(service, 'a', { action: 'delete-tag', name: 'v2', expectedId: id })).ok).toBe(false)
  expect((await changeRef(service, 'a', { action: 'create-branch', name: '../bad', startId: id })).ok).toBe(false)
  expect((await changeRef(service, 'a', { action: 'delete-tag', name: 'v2', expectedId: refs.find((ref) => ref.name === 'v2')!.objectId })).ok).toBe(true)
})

it('reports blob tags without offering a commit target', async () => {
  const root = fixture()
  const blob = git(root, 'rev-parse', 'HEAD:file')
  git(root, 'tag', 'blob-light', blob)
  git(root, 'tag', '-a', '-m', 'Blob', 'blob-note', blob)
  const refs = (await refRoster(core(root), 'a')).refs
  expect(refs.find((ref) => ref.name === 'blob-light')).toMatchObject({ commitId: null })
  expect(refs.find((ref) => ref.name === 'blob-note')).toMatchObject({ commitId: null })
})

it('fails closed when the worktree roster is truncated before a branch mutation', async () => {
  const root = fixture(), id = git(root, 'rev-parse', 'HEAD')
  git(root, 'branch', 'spare', id)
  const original = core(root)
  const service = { ...original, git: { ...original.git, git: async (args: readonly string[], options: Parameters<typeof original.git.git>[1]) => {
    const result = await original.git.git(args, options)
    return args[0] === 'worktree' ? { ...result, truncated: true } : result
  } } }
  await expect(changeRef(service, 'a', { action: 'delete-branch', name: 'spare', expectedId: id })).rejects.toThrow(/complete refs and worktrees/)
  expect(git(root, 'branch', '--list', 'spare')).toBe('spare')
})

it('waits for an alias task reservation before deleting a branch', async () => {
  const root = fixture(), db = makeTestDb(), at = Date.now()
  try {
    const id = git(root, 'rev-parse', 'HEAD')
    git(root, 'branch', 'reserved', id)
    await db.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
    for (const projectId of ['a', 'b']) await db.db.insert(schema.projects).values({ id: projectId, name: projectId, path: root,
      workspaceId: 'ws', sort: 0, hidden: false, vcs: 'git', defaultBranch: null, remoteUrl: null, githubOwner: null,
      githubName: null, githubRepoId: null, createdAt: at, updatedAt: at })
    const service = makeTestCoreServices(db)
    let release!: () => void, entered!: () => void
    const held = new Promise<void>((done) => { release = done }), ready = new Promise<void>((done) => { entered = done })
    const reservation = service.repositoryMetadata.write('b', async () => {
      db.db.insert(schema.tasks).values({ id: 'task', title: 'Archiving task', origin: 'local', projectId: 'b', branch: 'reserved',
        worktreePath: null, pullNumber: null, status: 'active', sort: 0, createdAt: at, updatedAt: at }).run()
      entered(); await held
    })
    await ready
    const deletion = changeRef(service, 'a', { action: 'delete-branch', name: 'reserved', expectedId: id })
    expect(git(root, 'branch', '--list', 'reserved')).toBe('reserved')
    release()
    await reservation
    expect((await deletion).reason).toContain('Archiving task')
    expect(git(root, 'branch', '--list', 'reserved')).toBe('reserved')
  } finally { db.cleanup() }
})

it('refuses an archived alias task branch while archive teardown still owns it', async () => {
  const root = fixture(), db = makeTestDb(), at = Date.now()
  try {
    const id = git(root, 'rev-parse', 'HEAD')
    git(root, 'branch', 'archiving', id)
    await db.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: at, updatedAt: at })
    for (const projectId of ['a', 'b']) await db.db.insert(schema.projects).values({ id: projectId, name: projectId, path: root,
      workspaceId: 'ws', sort: 0, hidden: false, vcs: 'git', defaultBranch: null, remoteUrl: null, githubOwner: null,
      githubName: null, githubRepoId: null, createdAt: at, updatedAt: at })
    db.db.insert(schema.tasks).values({ id: 'archived-task', title: 'Archive in progress', origin: 'local', projectId: 'b', branch: 'archiving',
      worktreePath: null, pullNumber: null, status: 'archived', archivedAt: at, sort: 0, createdAt: at, updatedAt: at }).run()
    const service = makeTestCoreServices(db)
    expect((await service.tasks.active()).map((task) => task.id)).not.toContain('archived-task')
    expect(beginTaskArchive('archived-task')).toBe(true)
    try {
      expect((await changeRef(service, 'a', { action: 'rename-branch', name: 'archiving', expectedId: id, nextName: 'renamed' })).reason)
        .toContain('Archive in progress')
      expect(git(root, 'branch', '--list', 'archiving')).toBe('archiving')
    } finally { finishTaskArchive('archived-task') }
  } finally { db.cleanup() }
})
