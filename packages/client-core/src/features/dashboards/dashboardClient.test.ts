import { expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { invalidatePublishedPanels, publishedDashboardPanelKey } from './dashboardClient'

const scope = { workspaceId: 'workspace' }
const read = (pluginId: string, connectionId?: string) => ({
  query: { source: { pluginId, sourceId: 'records' }, scope: { parameters: {}, ...(connectionId ? { connectionId } : {}) }, sort: [] },
})

it('refetches the placed panels that read a changed account or plugin', async () => {
  const client = new QueryClient()
  const work = publishedDashboardPanelKey('node', scope, 'work')
  const personal = publishedDashboardPanelKey('node', scope, 'personal')
  const elsewhere = publishedDashboardPanelKey('other-node', scope, 'work')
  client.setQueryData(work, { results: [read('github', 'work-account')] })
  client.setQueryData(personal, { results: [read('linear', 'personal-account')] })
  client.setQueryData(elsewhere, { results: [read('github', 'work-account')] })

  await invalidatePublishedPanels(client, 'node', { connectionId: 'work-account' })
  expect(client.getQueryState(work)?.isInvalidated).toBe(true)
  expect(client.getQueryState(personal)?.isInvalidated).toBe(false)
  expect(client.getQueryState(elsewhere)?.isInvalidated).toBe(false)

  await invalidatePublishedPanels(client, 'node', { pluginId: 'linear' })
  expect(client.getQueryState(personal)?.isInvalidated).toBe(true)
  client.clear()
})
