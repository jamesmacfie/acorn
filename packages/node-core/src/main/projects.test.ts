import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../server/db'
import { makeTestDb, type TestDb } from '../testkit/db'
import { createProject, createProjectRef, detectProject, parseGithubRemote, patchProject, projectByGithub } from './projects'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })

describe('parseGithubRemote', () => {
  it('parses https and ssh forms, with and without .git, case-insensitively', () => {
    expect(parseGithubRemote('https://github.com/acme/web.git')).toEqual({ owner: 'acme', name: 'web' })
    expect(parseGithubRemote('git@github.com:acme/web')).toEqual({ owner: 'acme', name: 'web' })
    expect(parseGithubRemote('ssh://git@GITHUB.COM/Acme/Web.git')).toEqual({ owner: 'Acme', name: 'Web' })
    expect(parseGithubRemote('https://gitlab.com/acme/web.git')).toBeNull()
    expect(parseGithubRemote('https://example.com/github.com/acme/web.git')).toBeNull()
    expect(parseGithubRemote('https://github.com.evil/acme/web.git')).toBeNull()
    expect(parseGithubRemote('')).toBeNull()
  })
})

describe('createProject / detectProject', () => {
  let testDb: TestDb
  let dir: string

  beforeEach(() => {
    testDb = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-projects-'))
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('accepts a plain folder: no git demanded, no facets detected', async () => {
    const folder = join(dir, 'notes')
    mkdirSync(folder)
    const result = await createProject(testDb.db, { path: folder })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.project).toMatchObject({ name: 'notes', path: folder, vcs: null, githubOwner: null, remoteUrl: null })
    // A default workspace was minted to hold it.
    const [workspace] = await testDb.db.select().from(schema.workspaces)
    expect(result.project.workspaceId).toBe(workspace.id)
  })

  it('detects the git facet, and the github facet only when the remote is github-shaped', async () => {
    const plainGit = join(dir, 'plain-git')
    mkdirSync(plainGit)
    git(plainGit, 'init')
    const withRemote = join(dir, 'with-remote')
    mkdirSync(withRemote)
    git(withRemote, 'init')
    git(withRemote, 'remote', 'add', 'origin', 'git@github.com:acme/web.git')
    const gitlab = join(dir, 'gitlab')
    mkdirSync(gitlab)
    git(gitlab, 'init')
    git(gitlab, 'remote', 'add', 'origin', 'https://gitlab.com/acme/api.git')

    const a = await createProject(testDb.db, { path: plainGit })
    const b = await createProject(testDb.db, { path: withRemote })
    const c = await createProject(testDb.db, { path: gitlab })
    expect(a.ok && a.project.vcs === 'git' && a.project.githubOwner === null).toBe(true)
    expect(b.ok && b.project.githubOwner === 'acme' && b.project.githubName === 'web').toBe(true)
    expect(c.ok && c.project.vcs === 'git' && c.project.githubOwner === null && c.project.remoteUrl === 'https://gitlab.com/acme/api.git').toBe(true)
    // Eleven real git processes: three inits, two remote adds, and two probes per detect. That fits in
    // the 5s default alone but not while the whole monorepo's suites run in parallel.
  }, 20_000)

  it('rejects relative and missing paths, and is idempotent on the same folder', async () => {
    expect(await createProject(testDb.db, { path: 'relative/path' })).toMatchObject({ ok: false })
    expect(await createProject(testDb.db, { path: join(dir, 'missing') })).toMatchObject({ ok: false })
    const folder = join(dir, 'once')
    mkdirSync(folder)
    const first = await createProject(testDb.db, { path: folder })
    const second = await createProject(testDb.db, { path: folder })
    expect(first.ok && second.ok && first.project.id === second.project.id).toBe(true)
  })

  it('rejects an unknown workspace and does not map two projects onto one folder', async () => {
    const firstFolder = join(dir, 'first')
    const secondFolder = join(dir, 'second')
    mkdirSync(firstFolder)
    mkdirSync(secondFolder)

    expect(await createProject(testDb.db, { path: firstFolder, workspaceId: 'missing' })).toEqual({ ok: false, reason: 'No such workspace.' })
    const first = await createProject(testDb.db, { path: firstFolder })
    const second = await createProject(testDb.db, { path: secondFolder })
    if (!first.ok || !second.ok) throw new Error('project setup failed')

    expect(await patchProject(testDb.db, second.project.id, { path: firstFolder })).toEqual({ ok: false, reason: 'Another project already uses that path.' })
    expect(await createProject(testDb.db, { path: secondFolder })).toMatchObject({ ok: true, project: { id: second.project.id } })
  })

  it('detectProject picks up a git init that happened after the project was added', async () => {
    const folder = join(dir, 'later-git')
    mkdirSync(folder)
    const created = await createProject(testDb.db, { path: folder })
    if (!created.ok) throw new Error('create failed')
    expect(created.project.vcs).toBeNull()
    git(folder, 'init')
    const detected = await detectProject(testDb.db, created.project.id)
    expect(detected?.vcs).toBe('git')
  })

  it('patchProject maps a folder onto a path-NULL project and re-detects', async () => {
    await createProjectRef(testDb.db, { name: 'web', github: { owner: 'acme', name: 'web' } })
    const project = await projectByGithub(testDb.db, 'acme', 'web')
    expect(project?.path).toBeNull()
    const folder = join(dir, 'web')
    mkdirSync(folder)
    git(folder, 'init')
    const patched = await patchProject(testDb.db, project!.id, { path: folder })
    expect(patched.ok && patched.project.path === folder && patched.project.vcs === 'git').toBe(true)
  })

  it('allows duplicate GitHub facets while projectByGithub resolves the oldest deterministically', async () => {
    await createProjectRef(testDb.db, { name: 'web', github: { owner: 'acme', name: 'web' } })
    const original = await projectByGithub(testDb.db, 'acme', 'web')
    if (!original) throw new Error('project setup failed')

    await testDb.db.insert(schema.projects).values({
      id: 'older-clone',
      name: 'web-old',
      path: null,
      workspaceId: original.workspaceId,
      githubOwner: 'Acme',
      githubName: 'Web',
      createdAt: 1,
      updatedAt: 1,
    })

    expect(await projectByGithub(testDb.db, 'ACME', 'WEB')).toMatchObject({ id: 'older-clone' })
    expect(await testDb.db.select().from(schema.projects)).toHaveLength(2)
  })

  it('canonicalizes GitHub facets written by the project import seam', async () => {
    const project = await createProjectRef(testDb.db, { name: 'web', github: { owner: ' Acme ', name: ' Web ' } })
    expect(project.github).toEqual({ owner: 'acme', name: 'web', repoId: null })
  })

})
