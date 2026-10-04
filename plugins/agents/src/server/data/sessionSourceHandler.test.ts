import { describe, expect, it } from 'vitest'
import type { ManagedAgentRuntime } from '../sessions/runtime'
import { createSessionSourceHandler } from './sessionSourceHandler'

const context = {
  principal: { kind: 'internal' as const, scope: 'service' as const, userId: 'owner' },
} as never

describe('managed session data source', () => {
  it('returns typed session records through the Node route', async () => {
    const runtime = { store: { listSessions: async () => ({ sessions: [{
      id: 'session-1', title: 'Review', providerId: 'codex', runtimeState: 'running',
      attention: 'none', model: null, taskId: 'task-1', createdAt: 1, updatedAt: 2,
    }] }) } } as unknown as ManagedAgentRuntime
    const handler = createSessionSourceHandler(runtime)
    const response = await handler(new Request('http://plugin/v1/p/agents/data/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        operation: 'query', mode: 'execution', evaluationTime: 7, pageSize: 25,
        query: { source: { pluginId: 'agents', sourceId: 'sessions' }, scope: { parameters: {} }, sort: [] },
      }),
    }), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      records: [{ recordId: 'session-1', data: { title: 'Review', state: 'running', model: null }, taskId: 'task-1', action: { verb: 'openPane', pane: 'agent' } }],
      completeness: { kind: 'complete' }, revision: '1', readTime: 7,
    })
  })

  // A store that pages at 100, like the real one, over `total` sessions.
  const pagedRuntime = (total: number) => ({ store: { listSessions: async (filter: { cursor?: string; limit: number }) => {
    const offset = filter.cursor ? Number(filter.cursor) : 0
    const end = Math.min(offset + Math.min(filter.limit, 100), total)
    return {
      sessions: Array.from({ length: end - offset }, (_, index) => ({
        id: `session-${String(offset + index).padStart(5, '0')}`, title: 'Run', providerId: 'codex', runtimeState: 'idle',
        attention: 'none', model: null, taskId: 'task-1', createdAt: 1, updatedAt: 2,
      })),
      nextCursor: end < total ? String(end) : null,
    }
  } } }) as unknown as ManagedAgentRuntime
  const query = (pageSize = 100) => new Request('http://plugin/v1/p/agents/data/sessions', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
      operation: 'query', mode: 'execution', evaluationTime: 7, pageSize,
      query: { source: { pluginId: 'agents', sourceId: 'sessions' }, scope: { parameters: {} }, sort: [] },
    }),
  })

  it('follows the store cursor past its 100-session page', async () => {
    const response = await createSessionSourceHandler(pagedRuntime(250))(query(), context)
    const body = await response.json() as { records: unknown[]; completeness: unknown }
    expect(body.records).toHaveLength(100)
    expect(body.completeness).toEqual({ kind: 'more', cursor: '100' })
  })

  it('says the read is incomplete when the host budget stops it', async () => {
    const response = await createSessionSourceHandler(pagedRuntime(6_000))(query(), context)
    await expect(response.json()).resolves.toMatchObject({ completeness: { kind: 'incomplete', cause: 'host-budget' } })
  })
})
