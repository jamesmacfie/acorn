import { expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { refreshNodeQueries, retryFailedPane } from './recovery'

it('refetches an inactive failed read after reconnect without sweeping healthy inactive reads', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let failedAttempts = 0
  let healthyAttempts = 0
  let reachable = false
  await expect(client.fetchQuery({
    queryKey: ['failed-pane'],
    queryFn: async () => {
      failedAttempts += 1
      if (!reachable) throw new Error('connection refused')
      return 'recovered'
    },
  })).rejects.toThrow('connection refused')
  await client.fetchQuery({
    queryKey: ['healthy-inactive'],
    queryFn: async () => { healthyAttempts += 1; return 'unchanged' },
  })

  reachable = true
  await refreshNodeQueries(client)

  expect(client.getQueryData(['failed-pane'])).toBe('recovered')
  expect(failedAttempts).toBe(2)
  expect(healthyAttempts).toBe(1)
  client.clear()
})

it('resets a failed pane after each manual retry, including a persistent failure', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let reachable = false
  let attempts = 0
  const query = {
    queryKey: ['failed-pane'],
    queryFn: async () => {
      attempts += 1
      if (!reachable) throw new Error('still offline')
      return 'ready'
    },
  }
  await expect(client.fetchQuery(query)).rejects.toThrow('still offline')
  let resets = 0

  await retryFailedPane(client, () => { resets += 1 })
  expect(attempts).toBe(2)
  expect(resets).toBe(1)
  expect(client.getQueryState(query.queryKey)?.status).toBe('error')

  reachable = true
  await retryFailedPane(client, () => { resets += 1 })
  expect(attempts).toBe(3)
  expect(resets).toBe(2)
  expect(client.getQueryData(query.queryKey)).toBe('ready')
  client.clear()
})
