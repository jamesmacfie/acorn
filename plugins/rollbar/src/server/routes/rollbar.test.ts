import { describe, expect, it } from 'vitest'
import { makeTestRequestContext } from '@acorn/plugin-api/testkit'
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
    // The host's request context, with canned answers only for the two provider calls that would
    // otherwise reach Rollbar's API. `withConnections` and `items` are not stubbed: they stay the
    // real runtime, so if this route starts reading the item store directly, the host's own
    // ownership check fails the test. An earlier version of this file stubbed them with a `throw`,
    // which only asserted what the file itself had written.
    const context = await makeTestRequestContext({
      plugin: 'rollbar',
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
      },
    })

    const response = await fetch(new Request('http://rollbar.test/rail-items?project=project-1'), context)
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      items: [{ title: 'rollbar-b', task: { origin: 'rollbar', link: { connectionId: 'rollbar-b' } } }],
    })
  })
})
