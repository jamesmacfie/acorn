/** @jsxImportSource @acorn/tui/jsx */
import { expect, it } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { renderCells } from './kit/render'
import { PaneFailure } from './panel'

it('offers keyboard Retry when a pane keeps failing', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let reachable = false
  let attempts = 0
  const query = {
    queryKey: ['pane-data'],
    queryFn: async () => {
      attempts += 1
      if (!reachable) throw new Error('connection refused')
      return 'ready'
    },
  }
  await expect(client.fetchQuery(query)).rejects.toThrow('connection refused')
  let resets = 0
  const screen = await renderCells(() => (
    <QueryClientProvider client={client}>
      <PaneFailure
        name="agent"
        nodeId="node-1"
        error={new Error('connection refused')}
        reset={() => { resets += 1 }}
        region={{ paneId: 'agent', regionId: 'failure' }}
      />
    </QueryClientProvider>
  ), { width: 80, height: 24 })
  try {
    expect(screen.text).toContain('connection refused')
    expect(screen.text).toContain('[Retry]')

    reachable = true
    await screen.press('RETURN')
    expect(attempts).toBe(2)
    expect(resets).toBe(1)
    expect(client.getQueryData(query.queryKey)).toBe('ready')
  } finally {
    screen.done()
    client.clear()
  }
})
