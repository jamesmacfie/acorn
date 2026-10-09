import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { CoreServices } from '@acorn/plugin-api/node'
import { pinComparison } from './comparison'
import { revision, search, segments } from './revision'

let root = ''
afterEach(() => { if (root) rmSync(root, { recursive: true, force: true }); root = '' })
const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
function fixture() {
  root = mkdtempSync(join(tmpdir(), 'acorn-compare-'))
  git('init', '-q', '-b', 'main')
  git('config', 'user.name', 'Acorn Test')
  git('config', 'user.email', 'test@acorn.dev')
  writeFileSync(join(root, 'root'), 'one\n')
  git('add', '.'); git('commit', '-qm', 'Root')
  const ancestor = git('rev-parse', 'HEAD')
  git('checkout', '-qb', 'side')
  writeFileSync(join(root, 'side'), 'side\n')
  git('add', '.'); git('commit', '-qm', 'Side')
  const side = git('rev-parse', 'HEAD')
  git('checkout', '-q', 'main')
  writeFileSync(join(root, 'main'), 'main\n')
  git('add', '.'); git('commit', '-qm', 'Main')
  const main = git('rev-parse', 'HEAD')
  return { ancestor, side, main }
}
function core() {
  return { projects: { byId: async () => ({ path: root }) }, tasks: { branchClaims: async () => [] },
    git: { git: async (args: readonly string[], opts: { cwd: string; stdin?: string }) => new Promise<{ code: number; stdout: string; stderr: string }>((done, fail) => {
      const child = spawn('git', [...args], { cwd: opts.cwd })
      child.stdin.on('error', () => {})
      const stdout: Buffer[] = [], stderr: Buffer[] = []
      child.stdin.end(opts.stdin ?? '')
      child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
      child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
      child.on('error', fail)
      child.on('close', (code) => done({ code: code ?? 1, stdout: Buffer.concat(stdout).toString(), stderr: Buffer.concat(stderr).toString() }))
    }) }, } as unknown as Pick<CoreServices, 'git' | 'projects' | 'tasks'>
}

it('pins direction and direct or merge-base modes, then reuses lazy revision reads', async () => {
  const { ancestor, side, main } = fixture()
  const service = core()
  const direct = await pinComparison(service, 'project', 'local:side', 'local:main', 'direct')
  expect(direct).toEqual({ source: side, destination: main, base: side, mode: 'direct' })
  const detail = await revision(service, 'project', direct.destination, direct.base, undefined, false, true)
  expect(detail.files.map((file) => file.path)).toEqual(['main', 'side'])
  expect(detail.topology.files.length).toBe(2)
  const file = detail.topology.files.find((entry) => entry.path === 'main')!
  if (file.patchKey && file.segments.length) expect(await segments(service, 'project', main, side, [{ path: file.path, patchKey: file.patchKey, ordinal: 0 }], undefined, true)).toHaveLength(1)
  expect((await search(service, 'project', main, side, { query: 'main', caseSensitive: false, cursor: null }, undefined, true))?.matches.length).toBeGreaterThan(0)
  await expect(revision(service, 'project', main, side)).rejects.toMatchObject({ code: 'bad_base' })
  const merged = await pinComparison(service, 'project', 'local:side', 'local:main', 'merge-base')
  expect(merged.base).toBe(ancestor)
  expect((await revision(service, 'project', merged.destination, merged.base, undefined, false, true)).files.map((file) => file.path)).toEqual(['main'])
  expect((await pinComparison(service, 'project', 'local:main', 'local:side', 'direct')).destination).toBe(side)
})
