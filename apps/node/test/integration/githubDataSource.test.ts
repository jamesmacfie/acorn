import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createPullSourceHandler, createBranchSourceHandler, pullSource, branchSource, githubProvider } from '@acorn/plugin-github/testkit'
import { panelPlanSchema } from '@acorn/protocol/dashboards.ts'
import type { DataSourceQuery } from '@acorn/protocol/dataSources.ts'
import { memoryIdentityStore } from '@acorn/node-core/server/activeIdentity.ts'
import { createCoreServices } from '@acorn/node-core/server/core/index.ts'
import { schema } from '@acorn/node-core/server/db/index.ts'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { clearRegistrations, initPlugins } from '@acorn/node-core/server/pluginHost/host.ts'
import { invokeDataSource } from '@acorn/node-core/server/dataSources'
import '@acorn/node-core/server/index.ts'
import { makeTestDb, testEnv, runDashboard } from '@acorn/node-core/testkit'

afterEach(() => { clearRegistrations('github'); vi.unstubAllGlobals() })

it('executes the GitHub source with exact connection provenance and a stable bounded take', async () => {
  const db = makeTestDb()
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: db.db, ACTIVE_IDENTITY: identity, SECRETS: db.secrets })
  try {
    await initPlugins([{ name: 'github', init(ctx) {
      ctx.providers.integration(githubProvider)
      ctx.routes.fetch(createPullSourceHandler(), { prefix: '/data/pulls' })
      ctx.dataSources.register(pullSource)
    } }], { env, dataDir: '', capabilities: new CapabilityRegistry(), core: createCoreServices({ db: db.db, secrets: db.secrets, activeIdentity: identity }) })
    await db.db.insert(schema.integrations).values({ id: 'selected', userId: 'owner', provider: 'github', label: 'GitHub',
      encryptedCredentials: await db.secrets.seal('selected-token'), authKind: 'oauth', status: 'connected', createdAt: 1, updatedAt: 1 })
    const fetch = vi.fn(async (_url: string, init: RequestInit) => {
      expect(init.headers).toMatchObject({ Authorization: 'Bearer selected-token' })
      return Response.json({ data: { search: { issueCount: 3, pageInfo: { hasNextPage: false, endCursor: null },
        nodes: ['z', 'b', 'a'].map(id => ({ id, number: 1, title: 'Change', url: 'https://github.com/org/repo/pull/1',
          state: 'OPEN', isDraft: true, author: { login: 'alice' }, repository: { nameWithOwner: 'org/repo' },
          headRepository: { nameWithOwner: 'org/repo' }, headRefName: 'feature',
          createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', closedAt: null, mergedAt: null,
          mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE', autoMergeRequest: null,
          reviewDecision: 'REVIEW_REQUIRED', latestCommit: { nodes: [] }, latestComment: { nodes: [] }, latestReview: { nodes: [] },
          statusCheckRollup: null, labels: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          reviewRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
          reviewRequestEvents: { nodes: [], pageInfo: { hasPreviousPage: false } } })),
      } } })
    })
    vi.stubGlobal('fetch', fetch)
    const result = await invokeDataSource(env, {
      operation: 'query', mode: 'execution', evaluationTime: 1, pageSize: 1,
      query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { connectionId: 'selected', parameters: { repositories: ['org/repo'] } },
        sort: [{ pointer: '/updatedAt', direction: 'desc' }], take: 2 },
    }, { principal: { kind: 'internal', scope: 'service', userId: 'owner' }, signal: new AbortController().signal })
    expect(result.completeness).toEqual({ kind: 'bounded' })
    expect(result.records[0]?.data).toMatchObject({ githubProvider: 'github', githubConnectionId: 'selected',
      headRepository: 'org/repo', headBranch: 'feature' })
    expect(result.records.map(record => record.ref)).toEqual(['a', 'b'].map(recordId => ({ pluginId: 'github', sourceId: 'pull-requests', connectionId: 'selected', recordId, scope: { connectionId: 'selected', parameters: { repositories: ['org/repo'] } } })))
    expect(fetch).toHaveBeenCalledTimes(1)
    const previewRequest = {
      operation: 'query' as const, mode: 'preview' as const, evaluationTime: 2, pageSize: 1,
      query: { source: { pluginId: 'github', sourceId: 'pull-requests' }, scope: { connectionId: 'selected', parameters: { repositories: ['org/repo'] } },
        sort: [{ pointer: '/updatedAt', direction: 'desc' as const }], take: 2 },
    }
    const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal }
    const first = await invokeDataSource(env, previewRequest, invocation)
    if (first.completeness.kind !== 'more') throw new Error('missing cursor')
    const last = await invokeDataSource(env, { ...previewRequest, cursor: first.completeness.cursor }, invocation)
    expect(last.mode).toBe('preview')
    expect(last.records.map(record => record.ref.recordId)).toEqual(['b'])
    expect(last.completeness.kind).toBe('bounded')
  } finally { db.cleanup() }
})

it('joins actual local branch and pull sources by account and fork head, retaining unmatched and ambiguous branches', async () => {
  const world = makeTestDb()
  const identity = memoryIdentityStore('owner')
  const env = testEnv({ DB: world.db, ACTIVE_IDENTITY: identity, SECRETS: world.secrets })
  const paths: string[] = []
  const git = (path: string, ...args: string[]) => execFileSync('git', args, { cwd: path, encoding: 'utf8' }).trim()
  const now = Date.now()
  try {
    await world.db.insert(schema.workspaces).values({ id: 'relation-ws', name: 'Workspace', isDefault: true, sort: 0, createdAt: now, updatedAt: now })
    for (const [index, repository] of ['base', 'other'].entries()) {
      const path = mkdtempSync(join(tmpdir(), 'acorn-pull-relation-'))
      paths.push(path)
      git(path, 'init', '-b', 'main')
      git(path, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'seed')
      git(path, 'branch', 'feature')
      git(path, 'remote', 'add', 'origin', `https://github.com/org/${repository}.git`)
      if (repository === 'base') {
        git(path, 'remote', 'add', 'fork', 'git@github.com:Fork/Widget.git')
        git(path, 'update-ref', 'refs/remotes/fork/feature', git(path, 'rev-parse', 'HEAD'))
        git(path, 'branch', '--set-upstream-to=fork/feature', 'feature')
      }
      await world.db.insert(schema.projects).values({ id: `relation-${repository}`, name: repository, path,
        workspaceId: 'relation-ws', sort: index, hidden: false, vcs: 'git', defaultBranch: 'main',
        remoteUrl: `https://github.com/org/${repository}.git`, githubOwner: 'org', githubName: repository,
        githubRepoId: null, createdAt: now, updatedAt: now })
    }
    await initPlugins([{ name: 'github', init(ctx) {
      ctx.providers.integration(githubProvider)
      ctx.routes.fetch(createPullSourceHandler(), { prefix: '/data/pulls' })
      ctx.dataSources.register(pullSource)
      ctx.routes.fetch(createBranchSourceHandler(ctx.dataSources.invoke), { prefix: '/data/branches' })
      ctx.dataSources.register(branchSource)
    } }], { env, dataDir: '', capabilities: new CapabilityRegistry(),
      core: createCoreServices({ db: world.db, secrets: world.secrets, activeIdentity: identity }) })
    for (const id of ['relation-account', 'other-account']) {
      await world.db.insert(schema.integrations).values({ id, userId: 'owner', provider: 'github', label: id,
        encryptedCredentials: await world.secrets.seal(`${id}-token`), authKind: 'oauth', status: 'connected', createdAt: now, updatedAt: now })
    }
    const node = (id: string, headRepository: string | null) => ({ id, number: 1, title: id,
      url: `https://github.com/org/base/pull/${id}`, state: 'OPEN', isDraft: false, author: { login: 'alice' },
      repository: { nameWithOwner: 'org/base' }, headRepository: headRepository ? { nameWithOwner: headRepository } : null, headRefName: 'feature',
      createdAt: '2026-09-01T00:00:00Z', updatedAt: '2026-09-02T00:00:00Z', closedAt: null, mergedAt: null,
      mergeable: 'UNKNOWN', mergeStateStatus: 'UNSTABLE', autoMergeRequest: null, reviewDecision: 'REVIEW_REQUIRED',
      latestCommit: { nodes: [] }, latestComment: { nodes: [] }, latestReview: { nodes: [] },
      labels: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      reviewRequests: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      reviewRequestEvents: { nodes: [], pageInfo: { hasPreviousPage: false } },
    })
    let nodes = [node('fork', 'Fork/Widget'), node('other', 'org/other'), node('deleted', null)]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: { search: { issueCount: nodes.length,
      pageInfo: { hasNextPage: false, endCursor: null }, nodes } } })))
    const invocation = { principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' }, signal: new AbortController().signal }
    const source = { pluginId: 'github', sourceId: 'local-branches' }
    const branchScope = (repository: string) => ({ workspaceId: 'relation-ws',
      connectionId: 'relation-account', parameters: { project: `relation-${repository}` } })
    const description = await invokeDataSource(env, { operation: 'describe', source, scope: branchScope('base') }, invocation)
    expect(description.relations?.[0]).toMatchObject({ id: 'branch-pull-request', target: { pluginId: 'github', sourceId: 'pull-requests' }, cardinality: 'many-to-one' })
    const reference = (query: DataSourceQuery) => ({
      kind: 'inline' as const, content: { name: 'Fixture', parameters: { type: 'object' as const, additionalProperties: false },
        sourceParameters: {}, query }, bindings: {},
    })
    const plan = panelPlanSchema.parse({ version: 2, title: 'Local branches with PRs', time: { zone: 'UTC', mode: 'fixed', weekStart: 'monday' },
      sources: [
        ...['base', 'other'].map(id => ({ id, label: id, role: 'primary', reference: reference({ source, scope: branchScope(id), sort: [] }) })),
        { id: 'pull', label: 'Pull requests', role: 'lookup', reference: reference({ source: { pluginId: 'github', sourceId: 'pull-requests' },
          scope: { workspaceId: 'relation-ws', connectionId: 'relation-account', parameters: {} }, sort: [] }) },
      ],
      relations: ['base', 'other'].map(from => ({ id: description.relations![0]!.id, from, to: 'pull',
        kind: description.relations![0]!.kind, cardinality: description.relations![0]!.cardinality,
        keys: description.relations![0]!.keys, unmatched: 'keep', maxMatches: 5000 })),
      columns: [
        { id: 'branch', label: 'Branch', type: 'text', bind: { base: { field: '/name' }, other: { field: '/name' } } },
        { id: 'pullUrl', label: 'Pull request', type: 'text', bind: { pull: { field: '/url' } } },
      ], stages: [], view: { kind: 'table' },
    })
    const run = (evaluationTime: number) => runDashboard(env, { scope: { workspaceId: 'relation-ws' },
      target: { kind: 'draft', content: plan }, mode: 'execution', evaluationTime }, invocation)
    const result = await run(now)
    expect(result.diagnostics.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(result.rows.filter(row => row.values.branch === 'feature').map(row => row.values.pullUrl)).toEqual([
      'https://github.com/org/base/pull/fork', 'https://github.com/org/base/pull/other',
    ])
    expect(result.rows.filter(row => row.values.branch === 'main').map(row => row.values.pullUrl)).toEqual([null, null])
    nodes = [node('fork', 'Fork/Widget'), node('duplicate', 'Fork/Widget')]
    const ambiguous = await run(now + 60_000)
    expect(ambiguous.diagnostics.problems.some(problem => problem.message.includes('violates many-to-one'))).toBe(true)
    expect(ambiguous.rows.filter(row => row.values.branch === 'feature').map(row => row.values.pullUrl)).toEqual([null, null])
    plan.sources[2]!.reference = reference({ source: { pluginId: 'github', sourceId: 'pull-requests' },
      scope: { workspaceId: 'relation-ws', connectionId: 'other-account', parameters: {} }, sort: [] })
    const foreign = await run(now + 120_000)
    expect(foreign.diagnostics.problems.filter(problem => problem.severity === 'error')).toEqual([])
    expect(foreign.rows.filter(row => row.values.branch === 'feature').map(row => row.values.pullUrl)).toEqual([null, null])
    await expect(invokeDataSource(env, { operation: 'query', mode: 'execution', evaluationTime: now, pageSize: 25,
      query: { source, scope: { ...branchScope('base'), connectionId: 'unavailable' }, sort: [] } }, invocation)).rejects.toThrow()
  } finally {
    world.cleanup()
    for (const path of paths) rmSync(path, { recursive: true, force: true })
  }
})
