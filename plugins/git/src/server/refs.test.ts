import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
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
    tasks: { active: async () => tasks },
    git: { git: async (args: readonly string[], opts: { cwd: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
      const child = spawn('git', [...args], { cwd: opts.cwd })
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', fail)
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) },
  } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks'>
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
