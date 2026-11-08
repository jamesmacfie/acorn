import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { schema } from '../db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { cloneRunState, startCloneRun, stopCloneRuns } from './clone'
import { createProject, createProjectRef, getProject } from './projects'

const { broadcasts } = vi.hoisted(() => ({ broadcasts: [] as Record<string, unknown>[] }))
vi.mock('../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  wsBroadcast: (frame: Record<string, unknown>) => void broadcasts.push(frame),
}))

describe('clone runs', () => {
  let t: TestDb
  let dir: string
  let origin: string
  const protocols = ['https', 'ssh', 'file']
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })

  beforeEach(() => {
    t = makeTestDb()
    broadcasts.length = 0
    dir = mkdtempSync(join(tmpdir(), 'acorn-clone-'))
    const work = join(dir, 'work')
    mkdirSync(work)
    git(work, 'init', '-q', '-b', 'main')
    writeFileSync(join(work, 'README.md'), 'hello\n')
    git(work, 'add', '.')
    git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init')
    origin = join(dir, 'web.git')
    git(dir, 'clone', '-q', '--bare', work, origin)
    mkdirSync(join(dir, 'parent'))
  })

  afterEach(() => {
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const finish = async (cloneId: string) => {
    for (;;) {
      const run = await cloneRunState(cloneId, 5_000)
      if (run.state !== 'running') return run
    }
  }
  const parent = () => join(dir, 'parent')

  it('clones into the named folder and registers it as a project', async () => {
    const started = await startCloneRun(
      { url: `file://${origin}`, parentDir: parent() },
      { db: t.db, ownerId: '', protocols },
    )
    if (!started.ok) throw new Error(started.error)
    const run = await finish(started.cloneId)
    if (run.state !== 'finished' || !run.result.ok) throw new Error(JSON.stringify(run))

    const project = await getProject(t.db, run.result.projectId)
    expect(project).toMatchObject({ path: join(parent(), 'web'), vcs: 'git', name: 'web', trusted: true })
    expect(readdirSync(parent())).toEqual(['web'])
    expect(existsSync(join(parent(), 'web', 'README.md'))).toBe(true)
    expect(broadcasts).toContainEqual({ channel: 'project:changed', projectId: project!.id })
    expect(broadcasts).toContainEqual({ channel: 'workspace:changed', workspaceId: project!.workspaceId })
  })

  it('writes an untrusted row, even over a row that already named the empty folder', async () => {
    const target = join(parent(), 'web')
    mkdirSync(target)
    const existing = await createProject(t.db, { path: target })
    if (!existing.ok) throw new Error(existing.reason)
    expect(existing.project.trusted).toBe(true)
    const started = await startCloneRun(
      { url: `file://${origin}`, parentDir: parent(), trusted: false },
      { db: t.db, ownerId: '', protocols },
    )
    if (!started.ok) throw new Error(started.error)
    expect(await finish(started.cloneId)).toEqual({
      state: 'finished',
      result: { ok: true, projectId: existing.project.id },
    })
    expect((await getProject(t.db, existing.project.id))?.trusted).toBe(false)
  })

  it('fills a placeholder project and writes the fields with its folder', async () => {
    const placeholder = await createProjectRef(t.db, {
      name: 'web',
      repository: { host: 'example.com', path: 'acme/web' },
    })
    const started = await startCloneRun(
      {
        url: `file://${origin}`,
        parentDir: parent(),
        name: 'checkout',
        fillProjectId: placeholder.id,
        fields: { repositoryExternalId: '42' },
      },
      { db: t.db, ownerId: '', protocols },
    )
    if (!started.ok) throw new Error(started.error)
    const run = await finish(started.cloneId)
    expect(run).toEqual({ state: 'finished', result: { ok: true, projectId: placeholder.id } })
    expect(await getProject(t.db, placeholder.id)).toMatchObject({
      path: join(parent(), 'checkout'),
      repoExternalId: '42',
    })
  })

  it('refuses a folder that exists and is not empty before git runs', async () => {
    mkdirSync(join(parent(), 'web'))
    writeFileSync(join(parent(), 'web', 'mine.txt'), 'keep me\n')
    const started = await startCloneRun(
      { url: `file://${origin}`, parentDir: parent() },
      { db: t.db, ownerId: '', protocols },
    )
    expect(started).toEqual({ ok: false, error: expect.stringContaining("already exists and isn't empty") })
    expect(readdirSync(parent())).toEqual(['web'])
  })

  it('clones into an empty folder that is already there', async () => {
    mkdirSync(join(parent(), 'web'))
    const started = await startCloneRun(
      { url: `file://${origin}`, parentDir: parent() },
      { db: t.db, ownerId: '', protocols },
    )
    if (!started.ok) throw new Error(started.error)
    expect(await finish(started.cloneId)).toMatchObject({ state: 'finished', result: { ok: true } })
    expect(existsSync(join(parent(), 'web', 'README.md'))).toBe(true)
  })

  it('leaves neither the hidden folder nor the target behind when git fails', async () => {
    const started = await startCloneRun(
      { url: `file://${join(dir, 'missing.git')}`, parentDir: parent() },
      { db: t.db, ownerId: '', protocols },
    )
    if (!started.ok) throw new Error(started.error)
    expect(await finish(started.cloneId)).toMatchObject({ state: 'finished', result: { ok: false } })
    expect(readdirSync(parent())).toEqual([])
    expect(t.db.select().from(schema.projects).all()).toEqual([])
  })

  it('refuses the file protocol unless the caller allows it', async () => {
    const started = await startCloneRun({ url: `file://${origin}`, parentDir: parent() }, { db: t.db, ownerId: '' })
    expect(started).toEqual({ ok: false, error: expect.stringContaining('not file') })
  })

  it('answers none for a run it never started', async () => {
    expect(await cloneRunState('nope', 0)).toEqual({ state: 'none' })
  })

  // Last, because the shutdown it simulates lasts for the rest of the module's life.
  it('stops a clone on shutdown and waits while it deletes its hidden folder', async () => {
    const started = await startCloneRun(
      { url: `file://${origin}`, parentDir: parent() },
      { db: t.db, ownerId: '', protocols },
    )
    if (!started.ok) throw new Error(started.error)
    await stopCloneRuns()
    expect(await cloneRunState(started.cloneId, 0)).toMatchObject({ state: 'finished', result: { ok: false } })
    expect(readdirSync(parent())).toEqual([])
  })
})
