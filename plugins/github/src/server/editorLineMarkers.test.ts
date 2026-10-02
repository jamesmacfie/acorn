import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { git, type CoreServices } from '@acorn/plugin-api/node'
import { makeTestPluginDb, type TestPluginDb } from '@acorn/plugin-api/testkit'
import { pullRequests, repos } from '../node/schema'
import { pullRequestEditorLineMarkers } from './editorLineMarkers'

let db: TestPluginDb
let root: string
let directory: string
let user: string | null
let head: string
let base: string
let core: Pick<CoreServices, 'tasks' | 'projects' | 'identity' | 'git'>
let commands: (readonly string[])[]
let beforeGit: (args: readonly string[]) => Promise<void>
const paths = Array.from({ length: 8 }, (_, index) => `file-${index}.txt`)
const setup = (...args: string[]) => execFileSync('git', args, { cwd: root }).toString().trim()
const commit = (message: string) => { setup('add', '.'); setup('commit', '-qm', message); return setup('rev-parse', 'HEAD') }

beforeEach(async () => {
  directory = root = mkdtempSync(join(tmpdir(), 'acorn-pr-markers-'))
  user = 'owner'
  commands = []
  beforeGit = async () => {}
  setup('init', '-q', '-b', 'main')
  setup('config', 'user.name', 'Fixture')
  setup('config', 'user.email', 'fixture@example.test')
  setup('config', 'commit.gpgsign', 'false')
  for (const path of paths) writeFileSync(join(root, path), 'base\nunchanged\n')
  base = commit('base')
  setup('update-ref', 'refs/remotes/origin/main', base)
  for (const path of paths) writeFileSync(join(root, path), 'base\npull\nunchanged\n')
  head = commit('pull')
  db = makeTestPluginDb('github')
  await db.db.insert(repos).values({ userId: 'owner', id: 1, owner: 'acme', name: 'widget', private: false, fetchedAt: 1 })
  await db.db.insert(pullRequests).values({ userId: 'owner', repoId: 1, number: 7, state: 'open', title: 'Pull', fetchedAt: 1, baseRef: 'main', headSha: head })
  core = {
    identity: { active: () => user },
    tasks: { root: async () => root, load: async () => ({ projectId: 'project', pullNumber: 7 }) },
    projects: { byId: async () => ({ github: { owner: 'acme', name: 'widget' } }) },
    git: { git: async (args: Parameters<typeof git>[0], options: Parameters<typeof git>[1]) => {
      commands.push(args)
      await beforeGit(args)
      return git(args, options)
    } },
  } as unknown as typeof core
})

afterEach(() => { db.cleanup(); rmSync(directory, { recursive: true, force: true }) })

it('shares one comparison across eight actual Git translations and resolves fresh refs after the wave', async () => {
  const provider = pullRequestEditorLineMarkers(db.db, core)
  for (const path of paths) writeFileSync(join(root, path), 'local\nbase\npull\nunchanged\n')
  expect(await Promise.all(paths.map((path) => provider.read('task', path)))).toEqual(paths.map(() => [{ from: 3, to: 3 }]))
  expect(commands).toHaveLength(20)
  expect(commands.filter((args) => args[0] === 'diff')).toHaveLength(16)
  setup('update-ref', 'refs/remotes/origin/main', head)
  commands = []
  expect(await provider.read('task', paths[0]!)).toEqual([])
  expect(commands).toHaveLength(6)
})

it('keeps PR provenance separate from later commits, local insertions, replacements, and deletions', async () => {
  const provider = pullRequestEditorLineMarkers(db.db, core)
  writeFileSync(join(root, paths[0]!), 'later\nbase\npull\nunchanged\n')
  commit('later local commit')
  expect(await provider.read('task', paths[0]!)).toEqual([{ from: 3, to: 3 }])
  writeFileSync(join(root, paths[0]!), 'later\nbase\nreplacement one\nreplacement two\nunchanged\n')
  expect(await provider.read('task', paths[0]!)).toEqual([{ from: 3, to: 4 }])
  writeFileSync(join(root, paths[0]!), 'later\nbase\nunchanged\n')
  expect(await provider.read('task', paths[0]!)).toEqual([])
})

it('resolves mirror, user, and authorized root before joining and rejects a changed source root', async () => {
  const provider = pullRequestEditorLineMarkers(db.db, core)
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const hold = new Promise<void>((resolve) => { release = resolve })
  beforeGit = async (args) => { if (args[0] === 'merge-base') { entered(); await hold } }
  const old = provider.read('task', paths[0]!)
  await started
  user = null
  expect(await provider.read('task', paths[1]!)).toEqual([])
  user = 'owner'
  await db.db.update(pullRequests).set({ headSha: base }).where(eq(pullRequests.number, 7))
  const fresh = provider.read('task', paths[1]!)
  release()
  expect(await fresh).toEqual([])
  expect(await old).toEqual([{ from: 2, to: 2 }])
  expect(commands.filter((args) => args[0] === 'merge-base')).toHaveLength(2)
  await expect(provider.read('task', paths[0]!, { root: '/different-authorized-root' })).rejects.toThrow('worktree changed')
  root = join(directory, 'absent-root')
  expect(await provider.read('task', paths[0]!)).toEqual([])
})

it('retires a rejected held wave and never publishes untranslated ranges after a failed file diff', async () => {
  const provider = pullRequestEditorLineMarkers(db.db, core)
  let release!: () => void
  let entered!: () => void
  const started = new Promise<void>((resolve) => { entered = resolve })
  const hold = new Promise<void>((resolve) => { release = resolve })
  beforeGit = async (args) => {
    if (args[0] === 'merge-base') { entered(); await hold; throw new Error('held failure') }
  }
  const failed = Promise.allSettled(paths.map((path) => provider.read('task', path)))
  await started
  release()
  expect((await failed).every((result) => result.status === 'rejected')).toBe(true)
  expect(commands.filter((args) => args[0] === 'merge-base')).toHaveLength(1)
  beforeGit = async () => {}
  expect(await provider.read('task', paths[0]!)).toEqual([{ from: 2, to: 2 }])
  beforeGit = async (args) => { if (args[0] === 'diff' && args[5] === '--') throw new Error('translation failed') }
  await expect(provider.read('task', paths[0]!)).rejects.toThrow('translation failed')
})

it('keeps equal PR refs on different users and roots in separate active waves', async () => {
  await db.db.insert(repos).values({ userId: 'other', id: 1, owner: 'acme', name: 'widget', private: false, fetchedAt: 1 })
  await db.db.insert(pullRequests).values({ userId: 'other', repoId: 1, number: 7, state: 'open', title: 'Pull', fetchedAt: 1, baseRef: 'main', headSha: head })
  const otherRoot = join(directory, 'other-checkout')
  setup('clone', '-q', root, otherRoot)
  execFileSync('git', ['update-ref', 'refs/remotes/origin/main', base], { cwd: otherRoot })
  const provider = pullRequestEditorLineMarkers(db.db, core)
  let release!: () => void
  const hold = new Promise<void>((resolve) => { release = resolve })
  beforeGit = async (args) => { if (args[0] === 'merge-base') await hold }
  const reads = [provider.read('task', paths[0]!)]
  // Let each request capture its resolved authority before changing the next owner's facts.
  await vi.waitFor(() => expect(commands.filter((args) => args[0] === 'merge-base')).toHaveLength(1))
  user = 'other'
  reads.push(provider.read('task', paths[1]!))
  await vi.waitFor(() => expect(commands.filter((args) => args[0] === 'merge-base')).toHaveLength(2))
  root = otherRoot
  reads.push(provider.read('task', paths[2]!))
  await vi.waitFor(() => expect(commands.filter((args) => args[0] === 'merge-base')).toHaveLength(3))
  release()
  expect(await Promise.all(reads)).toEqual([
    [{ from: 2, to: 2 }], [{ from: 2, to: 2 }], [{ from: 2, to: 2 }],
  ])
})

it('keeps branch validation, remote/local fallback, exact head SHA, and missing refs', async () => {
  const provider = pullRequestEditorLineMarkers(db.db, core)
  setup('update-ref', '-d', 'refs/remotes/origin/main')
  setup('update-ref', 'refs/heads/main', base)
  expect(await provider.read('task', paths[0]!)).toEqual([{ from: 2, to: 2 }])
  const execute = core.git.git
  core.git.git = async (args, options) => {
    const result = await execute(args, options)
    return args.at(-1) === `${head}^{commit}` ? { ...result, stdout: base } : result
  }
  expect(await provider.read('task', paths[0]!)).toEqual([])
  core.git.git = execute
  await db.db.update(pullRequests).set({ headSha: 'f'.repeat(40) }).where(eq(pullRequests.number, 7))
  expect(await provider.read('task', paths[0]!)).toEqual([])
  await db.db.update(pullRequests).set({ headSha: head, baseRef: '-invalid' }).where(eq(pullRequests.number, 7))
  expect(await provider.read('task', paths[0]!)).toEqual([])
})

it('reads literal filenames and bypasses repository text conversion and external diff drivers', async () => {
  const special = ['file[0].txt', 'file0.txt', ':(glob)odd.txt']
  setup('reset', '--hard', base)
  for (const path of special) writeFileSync(join(root, path), 'base\nunchanged\n')
  const specialBase = commit('literal base')
  setup('update-ref', 'refs/remotes/origin/main', specialBase)
  writeFileSync(join(root, special[0]!), 'base\npull\nunchanged\n')
  writeFileSync(join(root, special[1]!), 'pull\nbase\nunchanged\n')
  writeFileSync(join(root, special[2]!), 'base\npull\nunchanged\n')
  const specialHead = commit('literal pull')
  writeFileSync(join(root, '.gitattributes'), '*.txt diff=fixture\n')
  setup('config', 'diff.fixture.textconv', 'false')
  setup('config', 'diff.external', 'false')
  await db.db.update(pullRequests).set({ headSha: specialHead }).where(eq(pullRequests.number, 7))
  const provider = pullRequestEditorLineMarkers(db.db, core)
  expect(await provider.read('task', special[0]!)).toEqual([{ from: 2, to: 2 }])
  expect(await provider.read('task', special[1]!)).toEqual([{ from: 1, to: 1 }])
  expect(await provider.read('task', special[2]!)).toEqual([{ from: 2, to: 2 }])
})
