import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { dataSourceDescriptionSchema } from '@acorn/protocol/dataSources.ts'
import { readDataPointer } from '@acorn/protocol/dataValues.ts'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import { bindPanelRows, relatePanelRows, validatePanelPlan, type PlanSource } from '@acorn/dashboards-core/plan.ts'
import { memoryIdentityStore } from '../activeIdentity'
import { schema } from '../db'
import { makeTestDb, testEnv, type TestDb } from '../../testkit/db'
import { invokeDataSource } from './runtime'
import { parseLocalWorktrees } from './localGitSources'
import './localGitRegistration'

const worlds: TestDb[] = []
const paths: string[] = []
afterEach(() => {
  for (const world of worlds.splice(0)) world.cleanup()
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true })
})

const git = (path: string, ...args: string[]) => execFileSync('git', args, { cwd: path, encoding: 'utf8' }).trim()

describe('local Git worktree roster', () => {
  it('keeps managed and unmanaged trees and detached heads', () => {
    const roster = 'worktree /checkout\0HEAD aaaa\0branch refs/heads/main\0\0'
      + 'worktree /extra\0HEAD bbbb\0branch refs/heads/topic\0\0'
      + 'worktree /detached\0HEAD cccc\0detached\0\0'
      + 'worktree /stale\0HEAD dddd\0prunable gitdir missing\0\0'
    expect(parseLocalWorktrees(roster)).toEqual([
      { path: '/checkout', branch: 'main', head: 'aaaa' },
      { path: '/extra', branch: 'topic', head: 'bbbb' },
      { path: '/detached', branch: null, head: 'cccc' },
    ])
  })
})

describe('local branch relation source', () => {
  it('relates branches to pull requests using the tracked remote and selected account', async () => {
    const world = makeTestDb()
    worlds.push(world)
    const path = mkdtempSync(join(tmpdir(), 'acorn-branch-relation-'))
    paths.push(path)
    git(path, 'init', '-b', 'main')
    git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'seed')
    git(path, 'branch', 'feature')
    git(path, 'remote', 'add', 'origin', 'https://github.com/Org/Base.git')
    git(path, 'remote', 'add', 'fork', 'git@github.com:Fork/Widget.git')
    git(path, 'update-ref', 'refs/remotes/fork/feature', git(path, 'rev-parse', 'HEAD'))
    git(path, 'branch', '--set-upstream-to=fork/feature', 'feature')
    const otherPath = mkdtempSync(join(tmpdir(), 'acorn-branch-relation-'))
    paths.push(otherPath)
    git(otherPath, 'init', '-b', 'main')
    git(otherPath, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'seed')
    git(otherPath, 'branch', 'feature')
    git(otherPath, 'remote', 'add', 'origin', 'https://github.com/Org/Other.git')
    const now = Date.now()
    await world.db.insert(schema.workspaces).values({ id: 'ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    await world.db.insert(schema.projects).values({ id: 'project', name: 'Base', path, workspaceId: 'ws', sort: 0,
      hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/Org/Base.git',
      githubOwner: 'org', githubName: 'base', githubRepoId: null, createdAt: now, updatedAt: now })
    await world.db.insert(schema.projects).values({ id: 'other', name: 'Other', path: otherPath, workspaceId: 'ws', sort: 1,
      hidden: false, vcs: 'git', defaultBranch: 'main', remoteUrl: 'https://github.com/Org/Other.git',
      githubOwner: 'org', githubName: 'other', githubRepoId: null, createdAt: now, updatedAt: now })
    await world.db.insert(schema.integrations).values({ id: 'github-account', userId: 'owner', provider: 'github',
      label: 'GitHub', encryptedCredentials: 'unused', status: 'connected', createdAt: now, updatedAt: now })
    const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: memoryIdentityStore('owner') })
    const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' },
      signal: new AbortController().signal }
    const source = { pluginId: 'core', sourceId: 'local-branches' }
    const scope = { workspaceId: 'ws', projectId: 'project', parameters: { githubAccount: 'github-account' } }
    const description = dataSourceDescriptionSchema.parse(await invokeDataSource(env,
      { operation: 'describe', source, scope }, invocation))
    expect(description.relations).toEqual([expect.objectContaining({ id: 'branch-pull-request',
      target: { pluginId: 'github', sourceId: 'pull-requests' }, cardinality: 'many-to-one',
      requiredScopes: ['provider', 'account', 'container'] })])
    expect(description.relations?.[0]?.keys.map(key => key.scope)).toEqual(['provider', 'account', 'container', 'identity'])
    const accounts = await invokeDataSource(env, { operation: 'options', source, scope,
      target: 'parameter', pointer: '/githubAccount', search: 'Git', pageSize: 25 }, invocation)
    expect(accounts).toMatchObject({ options: [{ id: 'github-account', label: 'GitHub' }], exhausted: true })
    const page = await invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: now, pageSize: 25,
      query: { source, scope, sort: [] } }, invocation)
    expect(page.records.find(record => readDataPointer(record.data, '/name') === 'feature')?.data).toMatchObject({
      githubProvider: 'github', githubConnectionId: 'github-account', githubRepository: 'fork/widget', name: 'feature',
    })
    expect(readDataPointer(page.records.find(record => readDataPointer(record.data, '/name') === 'main')!.data,
      '/githubRepository')).toBe('org/base')
    const otherScope = { ...scope, projectId: 'other' }
    const otherPage = await invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: now, pageSize: 25,
      query: { source, scope: otherScope, sort: [] } }, invocation)
    expect(readDataPointer(otherPage.records.find(record => readDataPointer(record.data, '/name') === 'feature')!.data,
      '/githubRepository')).toBe('org/other')

    const pullDescription = dataSourceDescriptionSchema.parse({ revision: '6', consistency: 'GitHub pull fixture',
      schema: { type: 'object', additionalProperties: false, properties: {
        githubProvider: { type: 'string' }, githubConnectionId: { type: 'string' },
        headRepository: { type: ['string', 'null'] }, headBranch: { type: ['string', 'null'] }, url: { type: 'string' },
      } }, fields: ['/githubProvider', '/githubConnectionId', '/headRepository', '/headBranch', '/url']
        .map(pointer => ({ pointer, label: pointer, origin: 'declared' })),
      parameters: { type: 'object', additionalProperties: false }, parameterFields: [],
      operations: { query: true, options: false, details: false, incremental: false, groups: ['all'] },
    })
    const pull = { pluginId: 'github', sourceId: 'pull-requests' }
    const pullScope = { workspaceId: 'ws', connectionId: 'github-account', parameters: {} }
    const pullRecord = (id: string, headRepository: string | null, githubConnectionId = 'github-account') => ({
      ref: { ...pull, connectionId: 'github-account', recordId: id, scope: pullScope },
      data: { githubProvider: 'github', githubConnectionId, headRepository, headBranch: 'feature',
        url: `https://github.com/org/base/pull/${id}` },
    })
    const plan = panelPlanSchema.parse({ version: 2, title: 'Local branches with pull requests',
      time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
      sources: [
        { id: 'fork', label: 'Fork branches', role: 'primary', reference: { kind: 'inline', content: {
          name: 'Fork branches', parameters: { type: 'object', additionalProperties: false }, sourceParameters: {},
          query: { source, scope, sort: [] },
        }, bindings: {} } },
        { id: 'other', label: 'Other branches', role: 'primary', reference: { kind: 'inline', content: {
          name: 'Other branches', parameters: { type: 'object', additionalProperties: false }, sourceParameters: {},
          query: { source, scope: otherScope, sort: [] },
        }, bindings: {} } },
        { id: 'pull', label: 'Pull requests', role: 'lookup', reference: { kind: 'inline', content: {
          name: 'Pull requests', parameters: { type: 'object', additionalProperties: false }, sourceParameters: {},
          query: { source: pull, scope: pullScope, sort: [] },
        }, bindings: {} } },
      ],
      relations: ['fork', 'other'].map(from => ({ id: 'branch-pull-request', from, to: 'pull',
        kind: 'references', cardinality: 'many-to-one', keys: description.relations![0]!.keys,
        unmatched: 'keep', maxMatches: 5000 })),
      columns: [
        { id: 'branch', label: 'Branch', type: 'text', bind: { fork: { field: '/name' }, other: { field: '/name' } } },
        { id: 'pullUrl', label: 'Pull request', type: 'text', bind: { pull: { field: '/url' } } },
      ], stages: [], view: { kind: 'table' },
    })
    const pullSource: PlanSource = { instanceId: 'pull', label: 'Pull requests', description: pullDescription,
      query: { source: pull, scope: pullScope, sort: [] },
      result: { ...page, records: [pullRecord('fork', 'fork/widget'), pullRecord('other', 'org/other')] } }
    const sources: PlanSource[] = [
      { instanceId: 'fork', label: 'Fork branches', description, query: { source, scope, sort: [] }, result: page },
      { instanceId: 'other', label: 'Other branches', description, query: { source, scope: otherScope, sort: [] }, result: otherPage },
      pullSource,
    ]
    expect(validatePanelPlan(plan, sources).filter(problem => problem.severity === 'error')).toEqual([])
    const related = relatePanelRows(plan, sources, bindPanelRows(plan, sources))
    const features = related.rows.filter(row => row.values.branch === 'feature')
    expect(features.map(row => row.values.pullUrl)).toEqual([
      'https://github.com/org/base/pull/fork', 'https://github.com/org/base/pull/other',
    ])
    expect(related.rows.filter(row => row.values.branch === 'main').map(row => row.values.pullUrl)).toEqual([null, null])

    pullSource.result = { ...pullSource.result!, records: [pullRecord('fork', 'fork/widget'), pullRecord('duplicate', 'fork/widget')] }
    const ambiguous = relatePanelRows(plan, sources, bindPanelRows(plan, sources))
    expect(ambiguous.problems.some(problem => problem.message.includes('violates many-to-one'))).toBe(true)
    expect(ambiguous.rows.find(row => row.values.branch === 'feature' && row.records[0]?.recordId === page.records.find(record =>
      readDataPointer(record.data, '/name') === 'feature')?.ref.recordId)?.values.pullUrl).toBeNull()
    pullSource.result = { ...pullSource.result!, records: [pullRecord('foreign', 'fork/widget', 'another-account')] }
    expect(relatePanelRows(plan, sources, bindPanelRows(plan, sources)).rows.filter(row => row.values.branch === 'feature')
      .every(row => row.values.pullUrl === null)).toBe(true)
    pullSource.result = { ...pullSource.result!, records: [pullRecord('deleted-fork', null)] }
    expect(relatePanelRows(plan, sources, bindPanelRows(plan, sources)).rows.filter(row => row.values.branch === 'feature')
      .every(row => row.values.pullUrl === null)).toBe(true)
    const withoutAccount = await invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: now,
      pageSize: 25, query: { source, scope: { ...scope, parameters: {} }, sort: [] } }, invocation)
    expect(readDataPointer(withoutAccount.records[0]!.data, '/githubConnectionId')).toBeNull()
    await expect(invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: now, pageSize: 25,
      query: { source, scope: { ...scope, parameters: { githubAccount: 'foreign' } }, sort: [] } }, invocation)).rejects.toThrow()
  })
})
