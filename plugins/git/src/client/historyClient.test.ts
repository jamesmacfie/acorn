import { expect, it, vi } from 'vitest'

const readJson = vi.fn(async () => ({ topology: { files: [] } }))
const writeJson = vi.fn(async () => [])
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => 'node-a', nodeReady: () => true, readJson, writeJson,
}))

const { revisionApi, revisionOptions } = await import('./historyClient')

it('loads revision topology before any patch and requests segments only for visible paths', async () => {
  const controller = new AbortController()
  const selected = revisionOptions('project', 'commit', 'parent')
  await selected.queryFn({ signal: controller.signal })
  expect(readJson).toHaveBeenCalledWith(expect.stringContaining('/commit?base=parent'), { signal: controller.signal })
  expect(writeJson).not.toHaveBeenCalled()

  const visible = [{ path: 'file.txt', patchKey: 'patch', ordinal: 0 }]
  await revisionApi.segments('project', 'commit', 'parent', visible, controller.signal)
  expect(writeJson).toHaveBeenCalledWith(expect.stringContaining('/commit/segments'), expect.objectContaining({
    method: 'POST', signal: controller.signal, body: JSON.stringify({ base: 'parent', requests: visible }),
  }))
  expect(revisionOptions('project', 'another', 'parent').queryKey).not.toEqual(selected.queryKey)
  controller.abort()
  expect(controller.signal.aborted).toBe(true)
})
