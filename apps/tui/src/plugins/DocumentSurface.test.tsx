/** @jsxImportSource @acorn/tui/jsx */
import { expect, test, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { DocumentSurfaceProps } from '@acorn/client-core/host/frames/documentSurface.ts'
import { commandRegistry, keybindingRegistry } from '@acorn/client-core/host/registries/commands'
import { renderCells } from '../kit/render'
import { DocumentSurface } from './DocumentSurface'

const api = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
}))
vi.mock('@acorn/client-core/infra/node', () => ({ readJson: api.read, writeJson: api.write }))

const props = (onHandle: NonNullable<DocumentSurfaceProps['onHandle']>): DocumentSurfaceProps => ({
  pluginId: 'database',
  surfaceId: 'database',
  nodeId: 'node-a',
  scope: { taskId: 'task 1' },
  region: {
    languageId: 'sql',
    read: '/v1/p/database/tasks/:taskId/scratch',
    write: '/v1/p/database/tasks/:taskId/scratch',
  },
  onHandle,
})

test('a plugin document renders in cells and its sibling sees and saves the current edit', async () => {
  api.read.mockReset().mockResolvedValue({ text: 'select 1;' })
  const order: string[] = []
  api.write.mockReset().mockImplementation(async () => { order.push('save'); return {} })
  const command = commandRegistry.register({
    id: 'plugin.database.execute', title: 'Run query', category: 'action',
    run: () => { order.push('execute') },
  })
  const binding = keybindingRegistry.register({
    id: 'plugin.database.execute', command: 'plugin.database.execute', description: 'Run query',
    category: 'action', defaultChord: 'meta+enter', when: 'pane', pane: 'database',
    plugin: { id: 'database', name: 'Database', installedAt: () => 1, state: () => 'enabled' },
  })
  let handle: Parameters<NonNullable<DocumentSurfaceProps['onHandle']>>[0] = null
  const client = new QueryClient()
  const screen = await renderCells(() => <QueryClientProvider client={client}>
    <DocumentSurface {...props((next) => { handle = next })} />
  </QueryClientProvider>)
  try {
    await vi.waitFor(() => expect(handle).not.toBeNull())
    const frame = await screen.frame()
    expect(frame.text).toContain('select 1;')
    expect(frame.text).not.toContain('Unknown component type')
    expect(api.read).toHaveBeenCalledWith('/v1/p/database/tasks/task%201/scratch', { nodeId: 'node-a' })

    await screen.click(1, 0)
    await screen.press('x')
    expect(handle!.read()).toContain('x')
    handle!.write('select 2;')
    expect(handle!.read()).toBe('select 2;')
    await handle!.flush()
    expect(api.write).toHaveBeenCalledWith('/v1/p/database/tasks/task%201/scratch', expect.objectContaining({
      method: 'PUT',
      nodeId: 'node-a',
      body: JSON.stringify({ text: 'select 2;' }),
    }))
    expect((await screen.frame()).text).toContain('select 2;')
    handle!.write('select 3;')
    await screen.press('RETURN', { ctrl: true })
    await vi.waitFor(() => expect(order).toEqual(['save', 'save', 'execute']))
  } finally {
    screen.done()
    binding.dispose()
    command.dispose()
  }
  expect(handle).toBeNull()
})

test('an unreadable document reports the error and never hands the plugin an empty editor', async () => {
  api.read.mockReset().mockResolvedValue({ wrong: true })
  api.write.mockReset()
  const onHandle = vi.fn()
  const client = new QueryClient()
  const screen = await renderCells(() => <QueryClientProvider client={client}>
    <DocumentSurface {...props(onHandle)} />
  </QueryClientProvider>)
  try {
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('unreadable docum'))
    expect(onHandle).not.toHaveBeenCalled()
  } finally {
    screen.done()
  }
})
