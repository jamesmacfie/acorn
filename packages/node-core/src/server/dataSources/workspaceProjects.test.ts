import { afterEach, expect, it } from 'vitest'
import type { DataSourceDescription, DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { makeTestDb, testEnv } from '../../testkit/db'
import { schema } from '../db'
import { memoryIdentityStore } from '../activeIdentity'
import { clearDataSources, registerCoreDataSource } from './registry'
import { invokeDataSource } from './runtime'
import { recordProjectId, workspaceSourceProjects } from './workspaceProjects'

const worlds: ReturnType<typeof makeTestDb>[] = []
afterEach(() => { clearDataSources('core'); for (const world of worlds.splice(0)) world.cleanup() })

async function world() {
  const db = makeTestDb()
  worlds.push(db)
  await db.db.insert(schema.workspaces).values([{ id: 'w', name: 'Work', createdAt: 1, updatedAt: 1 }, { id: 'other', name: 'Other', createdAt: 1, updatedAt: 1 }])
  await db.db.insert(schema.projects).values([
    { id: 'p', name: 'Repo', path: '/repo', workspaceId: 'w', githubOwner: 'Org', githubName: 'Repo', createdAt: 1, updatedAt: 1 },
    { id: 'foreign', name: 'Foreign', path: '/foreign', workspaceId: 'other', githubOwner: 'Org', githubName: 'Foreign', createdAt: 1, updatedAt: 1 },
  ])
  return { db: db.db, env: testEnv({ DB: db.db, ACTIVE_IDENTITY: memoryIdentityStore('test-user') }) }
}

const description: DataSourceDescription = {
  revision: '1', consistency: 'fixture', schema: { type: 'object', properties: { repository: { type: 'string' } }, required: ['repository'], additionalProperties: false },
  fields: [], parameters: { type: 'object', properties: { repositories: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
  parameterFields: [{ pointer: '/repositories', label: 'Repositories', origin: 'declared', choices: { kind: 'dynamic', dependsOn: [] } }],
  operations: { query: true, options: true, details: false, incremental: false, groups: ['all'] },
  projectScope: { kind: 'repository', parameter: '/repositories', record: '/repository' },
}

it('narrows a workspace read before dispatch and carries the record owner through the reference', async () => {
  const { env } = await world()
  const queries: DataSourceQuery[] = []
  let returnedRepository = 'ORG/Repo'
  registerCoreDataSource({ sourceId: 'scoped-fixture', name: 'Repositories', singular: 'Repository', plural: 'Repositories', identityScope: 'fixture' }, request => {
    if (request.operation === 'describe') return description
    if (request.operation !== 'query') throw new Error('Unexpected operation')
    queries.push(request.query)
    return { records: [{ recordId: 'pr', data: { repository: returnedRepository } }], revision: '1', readTime: 1, completeness: { kind: 'complete' } }
  })
  const invoke = (parameters: Record<string, string[]>) => invokeDataSource(env, {
    operation: 'query', query: { source: { pluginId: 'core', sourceId: 'scoped-fixture' }, scope: { workspaceId: 'w', parameters }, sort: [] },
    mode: 'execution', evaluationTime: 1, pageSize: 25,
  }, { principal: { kind: 'internal', scope: 'service', userId: 'test-user' }, signal: new AbortController().signal })
  const result = await invoke({})
  expect(queries[0].scope.parameters.repositories).toEqual(['org/repo'])
  expect(result.records[0].ref).toMatchObject({ projectId: 'p', scope: { workspaceId: 'w' } })
  await invoke({ repositories: ['ORG/Repo', 'org/foreign'] })
  expect(queries[1].scope.parameters.repositories).toEqual(['org/repo'])
  expect((await invoke({ repositories: ['org/foreign'] })).records).toEqual([])
  expect(queries).toHaveLength(2)
  returnedRepository = 'org/foreign'
  await expect(invoke({})).rejects.toMatchObject({ code: 'invalid-response' })
})

it('reads past unrelated option pages and exposes only linked workspace repositories', async () => {
  const { env } = await world()
  const cursors: (string | undefined)[] = []
  registerCoreDataSource({ sourceId: 'options-fixture', name: 'Repositories', singular: 'Repository', plural: 'Repositories', identityScope: 'fixture' }, request => {
    if (request.operation === 'describe') return description
    if (request.operation !== 'options') throw new Error('Unexpected operation')
    cursors.push(request.cursor)
    return request.cursor
      ? { options: [{ id: 'org/repo', label: 'Org/Repo' }], exhausted: true }
      : { options: [{ id: 'org/foreign', label: 'Org/Foreign' }], exhausted: false, nextCursor: 'next' }
  })
  const result = await invokeDataSource(env, { operation: 'options', source: { pluginId: 'core', sourceId: 'options-fixture' },
    scope: { workspaceId: 'w', parameters: {} }, target: 'parameter', pointer: '/repositories', search: '', pageSize: 25 },
  { principal: { kind: 'internal', scope: 'service', userId: 'test-user' }, signal: new AbortController().signal })
  expect(result.options).toEqual([{ id: 'org/repo', label: 'Org/Repo' }])
  expect(result.exhausted).toBe(true)
  expect(cursors).toEqual([undefined, 'next'])
})

it('maps tracker records by workspace, account, and external project without guessing an owner', async () => {
  const { db, env } = await world()
  await db.insert(schema.workspaceExternalProjects).values([
    { workspaceId: 'w', integrationId: 'work', externalId: 'tracker-project', projectId: 'p', createdAt: 1 },
    { workspaceId: 'other', integrationId: 'work', externalId: 'tracker-project', projectId: 'foreign', createdAt: 1 },
    { workspaceId: 'w', integrationId: 'other-account', externalId: 'different-project', projectId: 'p', createdAt: 1 },
    { workspaceId: 'w', integrationId: 'work', externalId: 'workspace-only', projectId: '', createdAt: 1 },
  ])
  const mapping = { kind: 'external-project' as const, parameter: '/project', record: '/projectId' }
  const linked = (await workspaceSourceProjects(env, { workspaceId: 'w', connectionId: 'work', parameters: {} }, mapping))!
  expect(recordProjectId({ projectId: 'tracker-project' }, mapping, linked)).toBe('p')
  expect(recordProjectId({ projectId: 'workspace-only' }, mapping, linked)).toBeUndefined()
  expect(() => recordProjectId({ projectId: 'different-project' }, mapping, linked)).toThrow('invalid-response')
})

it('does not assign a repository with two local clones to an arbitrary project', async () => {
  const { db, env } = await world()
  await db.insert(schema.projects).values({ id: 'clone', name: 'Clone', path: '/clone', workspaceId: 'w', githubOwner: 'org', githubName: 'repo', createdAt: 1, updatedAt: 1 })
  const linked = (await workspaceSourceProjects(env, { workspaceId: 'w', parameters: {} }, description.projectScope!))!
  expect(recordProjectId({ repository: 'org/repo' }, description.projectScope!, linked)).toBeUndefined()
  const narrowed = (await workspaceSourceProjects(env, { workspaceId: 'w', projectId: 'p', parameters: {} }, description.projectScope!))!
  expect(recordProjectId({ repository: 'org/repo' }, description.projectScope!, narrowed)).toBe('p')
})
