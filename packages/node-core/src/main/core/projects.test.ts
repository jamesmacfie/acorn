import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { schema } from '../../server/db'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { createProjectService } from './projects'

describe('CoreServices.projects', () => {
  let testDb: TestDb
  let dir: string

  beforeEach(async () => {
    testDb = makeTestDb()
    dir = mkdtempSync(join(tmpdir(), 'acorn-project-service-'))
    const now = Date.now()
    await testDb.db.insert(schema.workspaces).values({ id: 'workspace-1', name: 'Default', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await testDb.db.insert(schema.projects).values([
      {
        id: 'project-old', name: 'widget', path: join(dir, 'old'), workspaceId: 'workspace-1', githubOwner: 'acme', githubName: 'widget', githubRepoId: 7,
        createdAt: 10, updatedAt: 10,
      },
      {
        id: 'project-new', name: 'widget clone', path: join(dir, 'new'), workspaceId: 'workspace-1', githubOwner: 'acme', githubName: 'widget', githubRepoId: 7,
        createdAt: 20, updatedAt: 20,
      },
      {
        id: 'project-plain', name: 'plain', path: join(dir, 'plain'), workspaceId: 'workspace-1', createdAt: 5, updatedAt: 5,
      },
    ])
  })

  afterEach(() => {
    testDb.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  it('exposes a narrow projection and oldest GitHub clone lookup', async () => {
    const projects = createProjectService(testDb.db)
    const ref = await projects.byId('project-old')
    expect(ref).toEqual({ id: 'project-old', name: 'widget', path: join(dir, 'old'), workspaceId: 'workspace-1', github: { owner: 'acme', name: 'widget', repoId: 7 } })
    expect(ref).not.toHaveProperty('setupScript')
    expect(ref).not.toHaveProperty('vcs')
    expect(await projects.byGithub('acme', 'widget')).toMatchObject({ id: 'project-old' })
    expect(await projects.byId('missing')).toBeNull()
  })

  it('returns only mapped project checkouts in deterministic order', async () => {
    const projects = createProjectService(testDb.db)
    expect(await projects.checkouts()).toEqual([
      { id: 'project-plain', path: join(dir, 'plain') },
      { id: 'project-old', path: join(dir, 'old') },
      { id: 'project-new', path: join(dir, 'new') },
    ])
  })

  it('supports controlled deferred creation and mapping updates', async () => {
    const projects = createProjectService(testDb.db)
    const deferred = await projects.create({ name: 'remote widget', path: null, github: { owner: 'acme', name: 'remote', repoId: 99 } })
    expect(deferred).toMatchObject({ name: 'remote widget', path: null, github: { owner: 'acme', name: 'remote', repoId: 99 } })

    const folder = join(dir, 'remote')
    mkdirSync(folder)
    const mapped = await projects.update(deferred.id, { path: folder })
    expect(mapped).toMatchObject({ id: deferred.id, path: folder, github: { owner: 'acme', name: 'remote', repoId: 99 } })
  })
})
