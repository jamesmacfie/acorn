import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../db'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { makeTestDb, type TestDb } from '../../testkit/db'
import {
  createProject,
  createProjectRef,
  detectProject,
  getProject,
  parseGitRemote,
  patchProject,
  projectByGithub,
  projectByRepository,
  toProjectRef,
  updateProjectRef,
} from './projects'
import { declareCodeHost } from '../pluginHost/codeHosts'
import { deleteProject } from './projectDeletion'

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: 'pipe' })

describe('parseGitRemote', () => {
  const github = { host: 'github.com', path: 'acme/web' }
  it('parses https, ssh, and scp-like forms, with and without .git, lowercased', () => {
    expect(parseGitRemote('https://github.com/acme/web.git')).toEqual(github)
    expect(parseGitRemote('git@github.com:acme/web')).toEqual(github)
    expect(parseGitRemote('git@github.com:/acme/web')).toEqual(github)
    expect(parseGitRemote('git@GITHUB.COM:/Acme/Web.git')).toEqual(github)
    expect(parseGitRemote('ssh://git@GITHUB.COM/Acme/Web.git')).toEqual(github)
    expect(parseGitRemote('https://user@github.com/acme/web/')).toEqual(github)
  })

  it('keeps any host and a nested path, and drops the port', () => {
    expect(parseGitRemote('git@gitlab.example.com:group/subgroup/repo.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'group/subgroup/repo',
    })
    expect(parseGitRemote('ssh://git@gitlab.example.com:2222/group/repo.git')).toEqual({
      host: 'gitlab.example.com',
      path: 'group/repo',
    })
    expect(parseGitRemote('https://bitbucket.org/workspace/repo.git')).toEqual({
      host: 'bitbucket.org',
      path: 'workspace/repo',
    })
    // The host is the URL's, so a lookalike path cannot borrow github.com.
    expect(parseGitRemote('https://example.com/github.com/acme/web.git')).toEqual({
      host: 'example.com',
      path: 'github.com/acme/web',
    })
    expect(parseGitRemote('https://github.com.evil/acme/web.git')?.host).toBe('github.com.evil')
  })

  it('refuses empty segments, queries, local paths, and other schemes', () => {
    expect(parseGitRemote('git@github.com://acme/web')).toBeNull()
    expect(parseGitRemote('https://github.com//acme/web')).toBeNull()
    expect(parseGitRemote('ssh://git@github.com//acme/web')).toBeNull()
    expect(parseGitRemote('https://github.com/acme/web?tab=1')).toBeNull()
    expect(parseGitRemote('/srv/git/web.git')).toBeNull()
    expect(parseGitRemote('file:///srv/git/web.git')).toBeNull()
    expect(parseGitRemote('https://github.com/acme/my web')).toBeNull()
    expect(parseGitRemote('')).toBeNull()
  })
})

describe('createProject / detectProject', () => {
  let testDb: TestDb
  let dir: string

  beforeEach(() => {
    testDb = makeTestDb()
    testDb.db.insert(schema.prefs).values({ userId: '', key: WORKSPACES_PREF_KEY, value: 'on' }).run()
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
    expect(
      c.ok &&
        c.project.vcs === 'git' &&
        c.project.githubOwner === null &&
        c.project.remoteUrl === 'https://gitlab.com/acme/api.git',
    ).toBe(true)
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

  it('reuses a project registered through another spelling of the same folder', async () => {
    const folder = join(dir, 'canonical')
    const alias = join(dir, 'alias')
    mkdirSync(folder)
    symlinkSync(folder, alias)
    const first = await createProject(testDb.db, { path: folder })
    const second = await createProject(testDb.db, { path: alias })
    const third = await createProject(testDb.db, { path: join(dir, 'canonical', '..', 'canonical') })
    expect(
      first.ok &&
        second.ok &&
        third.ok &&
        first.project.id === second.project.id &&
        second.project.id === third.project.id,
    ).toBe(true)
  })

  it('rejects an unknown workspace and does not map two projects onto one folder', async () => {
    const firstFolder = join(dir, 'first')
    const secondFolder = join(dir, 'second')
    mkdirSync(firstFolder)
    mkdirSync(secondFolder)

    expect(await createProject(testDb.db, { path: firstFolder, workspaceId: 'missing' })).toEqual({
      ok: false,
      reason: 'No such workspace.',
    })
    const first = await createProject(testDb.db, { path: firstFolder })
    const second = await createProject(testDb.db, { path: secondFolder })
    if (!first.ok || !second.ok) throw new Error('project setup failed')

    expect(await patchProject(testDb.db, second.project.id, { path: firstFolder })).toEqual({
      ok: false,
      reason: 'Another project already uses that path.',
    })
    const alias = join(dir, 'first-alias')
    symlinkSync(firstFolder, alias)
    expect(await patchProject(testDb.db, second.project.id, { path: alias })).toEqual({
      ok: false,
      reason: 'Another project already uses that path.',
    })
    expect(await createProject(testDb.db, { path: secondFolder })).toMatchObject({
      ok: true,
      project: { id: second.project.id },
    })
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

  describe('the repository facet', () => {
    const undos: (() => void)[] = []
    afterEach(() => undos.splice(0).forEach((undo) => undo()))
    const repo = (name: string, remote: string) => {
      const folder = join(dir, name)
      mkdirSync(folder)
      git(folder, 'init')
      git(folder, 'remote', 'add', 'origin', remote)
      return folder
    }

    it('gives an unclaimed host a host and path with no provider', async () => {
      const created = await createProject(testDb.db, {
        path: repo('nested', 'git@gitlab.example.com:group/sub/api.git'),
      })
      if (!created.ok) throw new Error('create failed')
      expect(toProjectRef(created.project)).toMatchObject({
        name: 'api',
        repository: { provider: null, host: 'gitlab.example.com', path: 'group/sub/api', externalId: null },
        github: null,
      })
      expect(created.project.githubOwner).toBeNull()
    }, 20_000)

    it('names the claiming plugin, and still names one installed after the project was added', async () => {
      const early = await createProject(testDb.db, { path: repo('early', 'https://gitlab.test/group/sub/api.git') })
      if (!early.ok) throw new Error('create failed')
      expect(early.project.repoProvider).toBeNull()
      undos.push(declareCodeHost('gitlab-test', { label: 'GitLab test', hosts: ['gitlab.test'] }, false))
      expect(toProjectRef(early.project).repository?.provider).toBe('gitlab-test')
      const late = await createProject(testDb.db, { path: repo('late', 'git@gitlab.test:group/sub/api.git') })
      if (!late.ok) throw new Error('create failed')
      expect(late.project.repoProvider).toBe('gitlab-test')
      // Two clones of one repository: the oldest wins, as with projectByGithub.
      expect((await projectByRepository(testDb.db, 'gitlab-test', 'Group/Sub/API'))?.id).toBe(early.project.id)
      expect(await projectByRepository(testDb.db, 'github', 'group/sub/api')).toBeNull()
    }, 20_000)

    it('reads a github.com repository as the GitHub facet, field for field', async () => {
      const project = await createProjectRef(testDb.db, {
        name: 'web',
        github: { owner: 'Acme', name: 'Web', repoId: 7 },
      })
      expect(project).toMatchObject({
        repository: { host: 'github.com', path: 'acme/web', externalId: '7' },
        github: { owner: 'acme', name: 'web', repoId: 7 },
      })
      const updated = await updateProjectRef(testDb.db, project.id, { repositoryExternalId: '42' })
      expect(updated?.github).toEqual({ owner: 'acme', name: 'web', repoId: 42 })
      // The GitHub columns follow, for readers that still query them.
      const row = await projectByGithub(testDb.db, 'acme', 'web')
      expect(row).toMatchObject({ githubOwner: 'acme', githubName: 'web', githubRepoId: 42, repoExternalId: '42' })
    })

    it('lets a holder set the external id only on the repository it holds, even across a path change', async () => {
      undos.push(declareCodeHost('gitlab-test', { label: 'GitLab test', hosts: ['gitlab.test'] }, false))
      const created = await createProject(testDb.db, { path: repo('held', 'git@gitlab.test:group/api.git') })
      if (!created.ok) throw new Error('create failed')
      const id = created.project.id
      await expect(updateProjectRef(testDb.db, id, { repositoryExternalId: '1' }, 'other')).rejects.toThrow(
        /gitlab\.test/,
      )
      expect(
        (await updateProjectRef(testDb.db, id, { repositoryExternalId: '1' }, 'gitlab-test'))?.repository,
      ).toMatchObject({ externalId: '1' })
      // Re-pointing the folder at a github.com clone in the same call doesn't carry the write across.
      const clone = repo('clone', 'git@github.com:acme/web.git')
      await expect(updateProjectRef(testDb.db, id, { path: clone, githubRepoId: 9 }, 'gitlab-test')).rejects.toThrow(
        /github\.com/,
      )
      expect(await getProject(testDb.db, id)).toMatchObject({ repoHost: 'github.com', githubRepoId: null })
    }, 20_000)

    it('keeps the provider and external id of the same repository when the claim goes away', async () => {
      const undo = declareCodeHost('gitlab-test', { label: 'GitLab test', hosts: ['gitlab.test'] }, false)
      const created = await createProject(testDb.db, { path: repo('kept', 'git@gitlab.test:group/api.git') })
      if (!created.ok) throw new Error('create failed')
      await updateProjectRef(testDb.db, created.project.id, { repositoryExternalId: '99' })
      undo()
      expect(await detectProject(testDb.db, created.project.id)).toMatchObject({
        repoProvider: 'gitlab-test',
        repoExternalId: '99',
      })
      git(created.project.path!, 'remote', 'set-url', 'origin', 'git@gitlab.test:group/other.git')
      expect(await detectProject(testDb.db, created.project.id)).toMatchObject({
        repoProvider: null,
        repoPath: 'group/other',
        repoExternalId: null,
      })
    }, 20_000)
  })

  // tasks.project_id carries no foreign key, so nothing in the database enforces this. Left undone it
  // strands rows that no rail can show and no screen can delete.
  it('deletes a project together with its task relations, and leaves other projects alone', async () => {
    const doomed = join(dir, 'doomed')
    const survivor = join(dir, 'survivor')
    mkdirSync(doomed)
    mkdirSync(survivor)
    const a = await createProject(testDb.db, { path: doomed })
    const b = await createProject(testDb.db, { path: survivor })
    if (!a.ok || !b.ok) throw new Error('fixture projects were not created')

    const task = (id: string, projectId: string) => ({
      id,
      title: id,
      origin: 'local',
      projectId,
      status: 'active' as const,
      sort: 0,
      createdAt: 1,
      updatedAt: 1,
    })
    await testDb.db
      .insert(schema.tasks)
      .values([task('doomed-1', a.project.id), task('doomed-2', a.project.id), task('keeper', b.project.id)])
    await testDb.db.insert(schema.taskLinks).values([
      { taskId: 'doomed-1', integrationId: 'linear', provider: 'linear', identifier: 'ENG-1', createdAt: 1 },
      { taskId: 'keeper', integrationId: 'linear', provider: 'linear', identifier: 'ENG-2', createdAt: 1 },
    ])
    await testDb.db.insert(schema.taskPulls).values([
      {
        taskId: 'doomed-2',
        repoOwner: 'acme',
        repoName: 'web',
        pullNumber: 10,
        role: 'related',
        provenance: 'agent',
        sessionId: 'session-a',
        createdAt: 1,
      },
      {
        taskId: 'keeper',
        repoOwner: 'acme',
        repoName: 'api',
        pullNumber: 20,
        role: 'related',
        provenance: 'agent',
        sessionId: 'session-b',
        createdAt: 1,
      },
    ])

    await deleteProject(testDb.db, a.project.id)

    expect((await testDb.db.select().from(schema.projects)).map((row) => row.id)).toEqual([b.project.id])
    expect((await testDb.db.select().from(schema.tasks)).map((row) => row.id)).toEqual(['keeper'])
    expect((await testDb.db.select().from(schema.taskLinks)).map((row) => row.taskId)).toEqual(['keeper'])
    expect((await testDb.db.select().from(schema.taskPulls)).map((row) => row.taskId)).toEqual(['keeper'])
  })
})
