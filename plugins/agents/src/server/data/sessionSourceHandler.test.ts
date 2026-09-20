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
    const response = await handler(new Request('http://plugin/v2/p/agents/data/sessions', {
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
})
