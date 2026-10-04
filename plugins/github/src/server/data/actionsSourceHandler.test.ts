import { expect, it, vi } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { dataSourcePageSchema } from '@acorn/protocol/dataSources.ts'
import { createActionsSourceHandler } from './actionsSourceHandler'
import { gh } from '../githubApi'

vi.mock('../githubApi', async original => ({ ...await original<typeof import('../githubApi')>(), gh: vi.fn() }))

it('reads failed jobs with attempts, linked pull requests, and a covered range', async () => {
  vi.mocked(gh).mockResolvedValueOnce(Response.json({ total_count: 1, workflow_runs: [{ id: 7, name: 'CI',
    run_attempt: 2, created_at: '2026-09-01T00:00:00Z', pull_requests: [{ number: 4 }] }] }))
    .mockResolvedValueOnce(Response.json({ total_count: 1, jobs: [{ id: 11, name: 'test', status: 'completed',
      conclusion: 'failure', started_at: '2026-09-01T01:00:00Z', completed_at: '2026-09-01T01:02:00Z',
      html_url: 'https://github.com/org/repo/actions/runs/7/job/11' }] }))
    .mockResolvedValueOnce(Response.json({ total_count: 1, jobs: [{ id: 12, name: 'test', status: 'completed',
      conclusion: 'success', started_at: '2026-09-01T02:00:00Z', completed_at: '2026-09-01T02:01:00Z',
      html_url: 'https://github.com/org/repo/actions/runs/7/job/12' }] }))
  const context = { userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {
    withConnections: async (_provider: string, visit: (connection: { id: string }, token: string) => Promise<unknown>) => [await visit({ id: 'connection' }, 'token')],
  } } as unknown as PluginRequestContext
  const request = new Request('http://acorn.test/', { method: 'POST', body: JSON.stringify({ operation: 'query',
    query: { source: { pluginId: 'github', sourceId: 'actions-jobs' }, scope: { connectionId: 'connection',
      parameters: { repositories: ['org/repo'] } }, sort: [], predicate: { kind: 'comparison',
      left: { address: { from: 'item', pointer: '/conclusion' } }, operator: 'eq', right: { address: { from: 'literal', value: 'failure' } } } },
    mode: 'execution', evaluationTime: Date.now(), pageSize: 25 }) })
  const response = await createActionsSourceHandler()(request, context)
  expect(response.status).toBe(200)
  const page = dataSourcePageSchema.parse(await response.json())
  expect(page.records).toHaveLength(1)
  expect(page.records[0]?.data).toMatchObject({ attempt: 1, durationMs: 120000, pullRequests: [4] })
  expect(page.records[0]?.actions?.[0]?.label).toBe('Re-run job')
  expect(page.coveredRange?.start).toBe(Date.parse('2026-09-01T00:00:00Z'))
  expect(vi.mocked(gh).mock.calls.map(call => call[1])).toEqual([
    '/repos/org/repo/actions/runs?per_page=100&page=1',
    '/repos/org/repo/actions/runs/7/attempts/1/jobs?per_page=100&page=1',
    '/repos/org/repo/actions/runs/7/attempts/2/jobs?per_page=100&page=1',
  ])
})

it('rechecks a scoped job before offering and dispatching Re-run job', async () => {
  const context = { userId: 'owner', principal: { kind: 'device', userId: 'owner' }, providers: {
    withConnections: async (_provider: string, visit: (connection: { id: string; status: string }, token: string) => Promise<unknown>) =>
      [await visit({ id: 'connection', status: 'connected' }, 'token')],
  } } as unknown as PluginRequestContext
  const ref = { pluginId: 'github', sourceId: 'actions-jobs', connectionId: 'connection', recordId: 'org/repo:11',
    scope: { connectionId: 'connection', parameters: { repositories: ['org/repo'] } } }
  const handler = createActionsSourceHandler()
  const post = (path: string, body: object) => handler(new Request(`http://acorn.test${path}`, {
    method: 'POST', body: JSON.stringify(body),
  }), context)

  vi.mocked(gh).mockResolvedValueOnce(Response.json({ id: 11, status: 'completed', conclusion: 'failure' }))
    .mockResolvedValueOnce(Response.json({ id: 11, status: 'completed', conclusion: 'failure' }))
    .mockResolvedValueOnce(new Response(null, { status: 201 }))
  const offered = await post('/data/actions', { operation: 'actions', ref, scope: ref.scope })
  expect(await offered.json()).toEqual({ actions: [{ id: 'rerun-job', label: 'Re-run job', risk: 'execute',
    action: { verb: 'runNodeAction', path: '/v1/p/github/data/actions/rerun' } }] })
  const dispatched = await post('/data/actions/rerun', { ref, actionId: 'rerun-job', idempotencyKey: crypto.randomUUID() })
  expect(dispatched.status).toBe(200)
  expect(vi.mocked(gh).mock.calls.at(-1)?.[1]).toBe('/repos/org/repo/actions/jobs/11/rerun')

  vi.mocked(gh).mockClear().mockResolvedValueOnce(Response.json({ id: 11, status: 'in_progress', conclusion: null }))
  const stale = await post('/data/actions/rerun', { ref, actionId: 'rerun-job', idempotencyKey: crypto.randomUUID() })
  expect(stale.status).toBe(409)
  expect(vi.mocked(gh)).toHaveBeenCalledTimes(1)
  const foreign = await post('/data/actions/rerun', { ref: { ...ref, scope: { ...ref.scope, parameters: { repositories: ['other/repo'] } } },
    actionId: 'rerun-job', idempotencyKey: crypto.randomUUID() })
  expect(foreign.status).toBe(409)
  expect(vi.mocked(gh)).toHaveBeenCalledTimes(1)
})
