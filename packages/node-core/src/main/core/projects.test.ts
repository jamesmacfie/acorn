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
    await testDb.db.insert(schema.integrations).values([
      {
        id: 'rollbar-a', userId: 'owner', provider: 'rollbar', label: 'Rollbar A', authRef: 'secret',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'rollbar-b', userId: 'owner', provider: 'rollbar', label: 'Rollbar B', authRef: 'secret',
        createdAt: now, updatedAt: now,
      },
      {
        id: 'linear-a', userId: 'owner', provider: 'linear', label: 'Linear A', authRef: 'secret',
        createdAt: now, updatedAt: now,
      },
    ])
    await testDb.db.insert(schema.workspaceExternalProjects).values([
      { workspaceId: 'workspace-1', integrationId: 'rollbar-b', externalId: 'project-b', createdAt: now },
      { workspaceId: 'workspace-1', integrationId: 'rollbar-a', externalId: 'project-a', createdAt: now },
      { workspaceId: 'workspace-1', integrationId: 'linear-a', externalId: 'team-a', createdAt: now },
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

  it('returns opaque external-project mappings in deterministic order', async () => {
    const projects = createProjectService(testDb.db)
    expect(await projects.externalProjects('workspace-1')).toEqual([
      { connectionId: 'linear-a', externalId: 'team-a' },
      { connectionId: 'rollbar-a', externalId: 'project-a' },
      { connectionId: 'rollbar-b', externalId: 'project-b' },
    ])
    expect(await projects.externalProjects('missing')).toEqual([])
  })

  it('filters external-project mappings at the database boundary by provider', async () => {
    const projects = createProjectService(testDb.db)
    expect(await projects.externalProjects('workspace-1', ['rollbar'])).toEqual([
      { connectionId: 'rollbar-a', externalId: 'project-a' },
      { connectionId: 'rollbar-b', externalId: 'project-b' },
    ])
    expect(await projects.externalProjects('workspace-1', ['linear'])).toEqual([
      { connectionId: 'linear-a', externalId: 'team-a' },
    ])
    expect(await projects.externalProjects('workspace-1', [])).toEqual([])
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
