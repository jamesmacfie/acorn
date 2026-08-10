import { describe, expect, it } from 'vitest'
import type { PluginRequestContext } from '@acorn/plugin-api/node'
import { createRollbarFetch } from './rollbar'

const item = (integrationId: string) => ({
  integrationId,
  integrationLabel: integrationId,
  identifier: integrationId === 'rollbar-a' ? '1' : '2',
  itemId: '',
  url: null,
  title: integrationId,
  level: 'error',
  environment: 'production',
  status: 'active',
  totalOccurrences: 1,
  firstOccurrenceAt: 1,
  lastOccurrenceAt: 2,
})

describe('Rollbar loaded routes', () => {
  it('intersects the active workspace mapping with provider-owned connections', async () => {
    const fetch = createRollbarFetch({
      byId: async (id) => id === 'project-1' ? ({ id, workspaceId: 'workspace-1' } as never) : null,
      externalProjects: async () => [{ connectionId: 'rollbar-b', externalId: 'project-b' }],
    })
    const context: PluginRequestContext = {
      userId: 'user-1',
      principal: { kind: 'device', userId: 'user-1', deviceId: 'device-1' },
      providers: {
        connections: async () => [
          { id: 'rollbar-a' } as never,
          { id: 'rollbar-b' } as never,
        ],
        resource: async (request) => ({
          ok: true,
          value: { items: [item(request.connectionId)], capped: false },
        }) as never,
        withConnections: async () => [],
      },
    }

    const response = await fetch(new Request('http://rollbar.test/rail-items?project=project-1'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      items: [{ title: 'rollbar-b', task: { origin: 'rollbar', link: { connectionId: 'rollbar-b' } } }],
    })
  })
})
