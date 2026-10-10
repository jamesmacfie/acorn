/** @jsxImportSource @acorn/tui/jsx */
import { expect, test, vi } from 'vitest'
import { MAX_DOCUMENT_BYTES } from '@acorn/protocol/plugin/bridge.ts'
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

test('a failed terminal draft survives a Node switch and remount while its retired handle loses authority', async () => {
  api.read.mockReset().mockResolvedValue({ text: 'SELECT stored;' })
  api.write.mockReset().mockRejectedValue(new Error('offline'))
  let handle: Parameters<NonNullable<DocumentSurfaceProps['onHandle']>>[0] = null
  const options = (nodeId = 'node-a') => ({ ...props((next) => { handle = next }), nodeId, scope: { taskId: 'tui-failed-recovery' } })
  const mount = async (nodeId = 'node-a') => renderCells(() => <QueryClientProvider client={new QueryClient()}>
    <DocumentSurface {...options(nodeId)} />
  </QueryClientProvider>)
  const first = await mount()
  await vi.waitFor(() => expect(handle).not.toBeNull())
  const retired = handle!
  retired.write('SELECT unsent;')
  await expect(retired.flush()).rejects.toThrow('offline')
  first.done()
  expect(() => retired.read()).toThrow('retired')
  expect(() => retired.write('SELECT wrong_node;')).toThrow('retired')
  await expect(retired.flush()).rejects.toThrow('retired')
  await Promise.resolve()
  const other = await mount('node-b')
  try {
    await vi.waitFor(() => expect(handle).not.toBeNull())
    expect(handle!.read()).toBe('SELECT stored;')
  } finally { other.done() }
  await Promise.resolve()
  const reopened = await mount()
  try {
    await vi.waitFor(() => expect(handle).not.toBeNull())
    expect(handle!.read()).toBe('SELECT unsent;')
    api.write.mockResolvedValue({})
    await handle!.flush()
    expect(api.write).toHaveBeenLastCalledWith('/v1/p/database/tasks/tui-failed-recovery/scratch', expect.objectContaining({ nodeId: 'node-a', body: JSON.stringify({ text: 'SELECT unsent;' }) }))
  } finally { reopened.done() }
})

test('an oversized stored terminal document exposes recovery instructions and never writes an empty buffer', async () => {
  api.read.mockReset().mockResolvedValue({ text: 'é'.repeat(MAX_DOCUMENT_BYTES) })
  api.write.mockReset()
  const onHandle = vi.fn()
  const screen = await renderCells(() => <QueryClientProvider client={new QueryClient()}>
    <DocumentSurface {...props(onHandle)} scope={{ taskId: 'tui-legacy-oversize' }} />
  </QueryClientProvider>)
  try {
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('Document exceeds 2 MiB'))
    expect(onHandle).not.toHaveBeenCalled()
    expect(api.write).not.toHaveBeenCalled()
  } finally { screen.done() }
  expect(api.write).not.toHaveBeenCalled()
})

test('Inspect position and Diagnostics ask the region\'s own routes about the live buffer, and refuse a stale answer', async () => {
  api.read.mockReset().mockResolvedValue({ text: 'select x' })
  api.write.mockReset().mockResolvedValue({})
  // The region's routes are reached over `fetch` here, because no Node transport is installed.
  const asked: { path: string; body: { text: string; revision: number; position?: { line: number; column: number } } }[] = []
  let answer = (path: string, body: { revision: number }): unknown => path.endsWith('/hover')
    ? { revision: body.revision, contents: { kind: 'markdown', value: '**users**: a table' } }
    : { revision: body.revision, items: [{ range: { start: { line: 1, column: 8 }, end: { line: 1, column: 9 } }, severity: 'error', message: 'No column x' }] }
  vi.stubGlobal('fetch', vi.fn(async (path: string, init: { body: Uint8Array }) => {
    const body = JSON.parse(new TextDecoder().decode(init.body))
    asked.push({ path, body })
    return new Response(JSON.stringify(answer(path, body)), { headers: { 'content-type': 'application/json' } })
  }))
  const region = {
    ...props(() => {}).region,
    hover: { route: '/v1/p/database/tasks/:taskId/hover' },
    diagnostics: { route: '/v1/p/database/tasks/:taskId/check' },
  }
  const screen = await renderCells(() => <QueryClientProvider client={new QueryClient()}>
    <DocumentSurface {...props(() => {})} scope={{ taskId: 'tui-services' }} region={region} />
  </QueryClientProvider>)
  const press = async (label: string) => {
    const rows = (await screen.frame()).text.split('\n')
    const y = rows.findIndex((row) => row.includes(label))
    await screen.click(rows[y]!.indexOf(label) + 1, y)
  }
  try {
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('Inspect position'))
    await press('Diagnostics')
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('1:8 error No column x'))
    expect(asked[0]).toEqual({ path: '/v1/p/database/tasks/tui-services/check', body: { text: 'select x', revision: expect.any(Number) } })

    await press('Inspect position')
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('users: a table'))
    expect(asked[1]!.path).toBe('/v1/p/database/tasks/tui-services/hover')
    expect(asked[1]!.body.position).toEqual({ line: 1, column: expect.any(Number) })

    answer = (_path, body) => ({ revision: body.revision + 1, items: [] })
    await press('Diagnostics')
    await vi.waitFor(async () => expect((await screen.frame()).text).toContain('did not answer'))
  } finally {
    screen.done()
    vi.unstubAllGlobals()
  }
})
