import { QueryClient } from '@tanstack/solid-query'
import { beforeEach, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({
  read: vi.fn(async (_url: string, _options?: { nodeId?: string | null }): Promise<unknown> => ({ root: '/origin' })),
  write: vi.fn(async (_url: string, _options: { nodeId?: string | null }) => ({ ok: true, text: 'formatted', revision: 'revision' })),
  node: 'incoming' as string | null,
  owner: 'origin' as string | null | undefined,
}))
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => transport.node,
  queryOwner: () => transport.owner,
  readJson: transport.read,
  writeJson: transport.write,
  readBytes: vi.fn(),
}))
const { editorApi, prefetchEditorRoot } = await import('./editorClient')

beforeEach(() => {
  transport.read.mockReset().mockResolvedValue({ root: '/origin' })
  transport.write.mockReset().mockResolvedValue({ ok: true, text: 'formatted', revision: 'revision' })
  transport.owner = 'origin'
  transport.node = 'incoming'
})

it('captures the QueryClient owner for requests and prefetch before ambient selection changes', async () => {
  const queryClient = new QueryClient()
  const api = editorApi(queryClient)
  transport.node = 'replacement'
  await api.read('same-task', 'a.txt')
  await api.write('same-task', 'a.txt', 'submitted')
  expect(transport.read.mock.calls[0]).toEqual([expect.any(String), { nodeId: 'origin' }])
  expect(transport.write.mock.calls[0]?.[1]).toMatchObject({ nodeId: 'origin' })
  prefetchEditorRoot(queryClient, 'same-task')
  await vi.waitFor(() => expect(transport.read).toHaveBeenCalledTimes(2))
  expect(transport.read.mock.calls[1]?.[1]).toMatchObject({ nodeId: 'origin' })
  queryClient.clear()
})

it('preserves a captured serving origin represented by null', async () => {
  transport.owner = null
  await editorApi(new QueryClient()).root('task')
  expect(transport.read.mock.calls[0]?.[1]).toEqual({ nodeId: null })
})

it('keeps an old peer acknowledgement unverifiable instead of claiming submitted text persisted', async () => {
  transport.write.mockResolvedValueOnce({ ok: true } as Awaited<ReturnType<typeof transport.write>>)
  expect(await editorApi().write('task', 'file', 'unformatted')).toMatchObject({ ok: false, reason: expect.stringContaining('acknowledge') })
})

it('keeps marker transport on its captured Node and rejects legacy arrays or a different body', async () => {
  const api = editorApi(new QueryClient())
  transport.node = 'replacement'
  const revision = 'a'.repeat(64)
  transport.read.mockResolvedValueOnce([]).mockResolvedValueOnce({ revision: 'b'.repeat(64), markers: [] })
    .mockResolvedValueOnce({ revision, markers: [] })
  expect(await api.lineMarkers('task', 'a.txt', revision)).toBeNull()
  expect(await api.lineMarkers('task', 'a.txt', revision)).toBeNull()
  expect(await api.lineMarkers('task', 'a.txt', revision)).toEqual({ revision, markers: [] })
  expect(transport.read.mock.calls.every(([url, options]) => url.includes(`revision=${revision}`) && options?.nodeId === 'origin')).toBe(true)
})
