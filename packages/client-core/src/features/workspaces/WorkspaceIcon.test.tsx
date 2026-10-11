import { afterEach, expect, it, vi } from 'vitest'
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import type { WorkspaceAppearance } from '@acorn/protocol/workspaceAppearance.ts'
import { WorkspaceIdentity } from './WorkspaceIcon'
import { readBytes } from '../../infra/node/apiClient'

vi.mock('../../infra/node/apiClient', () => ({ readBytes: vi.fn() }))
const image = (id: string): WorkspaceAppearance => ({ version: 1, kind: 'image', imageId: id.repeat(64) })
let dispose: (() => void) | undefined
afterEach(async () => {
  dispose?.()
  dispose = undefined
  await Promise.resolve()
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.mocked(readBytes).mockReset()
})

it('shares immutable images per Node, releases URLs, and ignores late reads after replacement', async () => {
  const finish: ((value: { bytes: Uint8Array; type: string; filename: null }) => void)[] = []
  vi.mocked(readBytes).mockImplementation(() => new Promise((resolve) => finish.push(resolve)))
  const makeUrl = vi.fn().mockReturnValueOnce('blob:current').mockReturnValueOnce('blob:other-node')
  const revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: makeUrl })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke })
  const [appearance, setAppearance] = createSignal(image('a'))
  const [node, setNode] = createSignal('node-a')
  const [name, setName] = createSignal('Runn')
  dispose = render(
    () => (
      <>
        <WorkspaceIdentity name={name()} appearance={appearance()} nodeId={node()} />
        <WorkspaceIdentity name="Acorn" appearance={appearance()} nodeId={node()} />
      </>
    ),
    document.body,
  )
  expect(readBytes).toHaveBeenCalledTimes(1)
  setName('Renamed')
  expect(readBytes).toHaveBeenCalledTimes(1)
  setAppearance(image('b'))
  await Promise.resolve()
  finish[0]({ bytes: new Uint8Array([1]), type: 'image/png', filename: null })
  await Promise.resolve()
  expect(makeUrl).not.toHaveBeenCalled()
  finish[1]({ bytes: new Uint8Array([2]), type: 'image/png', filename: null })
  await Promise.resolve()
  expect([...document.querySelectorAll('img')].map((img) => img.src)).toEqual(['blob:current', 'blob:current'])
  setNode('node-b')
  await Promise.resolve()
  expect(revoke).toHaveBeenCalledWith('blob:current')
  expect(readBytes).toHaveBeenCalledTimes(3)
  expect(vi.mocked(readBytes).mock.calls[2][2]).toMatchObject({ nodeId: 'node-b' })
  finish[2]({ bytes: new Uint8Array([3]), type: 'image/png', filename: null })
  await Promise.resolve()
  expect([...document.querySelectorAll('img')].map((img) => img.src)).toEqual(['blob:other-node', 'blob:other-node'])
  document.querySelector('img')!.dispatchEvent(new Event('error'))
  expect(document.body.textContent).toContain('RE')
  dispose()
  dispose = undefined
  await Promise.resolve()
  expect(revoke).toHaveBeenCalledWith('blob:other-node')
})

it('renders initials for missing and unsupported appearances, updates them on rename, and survives failed image reads', async () => {
  vi.mocked(readBytes).mockRejectedValue(new Error('offline'))
  const [name, setName] = createSignal('Runn Workspace')
  const [appearance, setAppearance] = createSignal<WorkspaceAppearance | null>(null)
  dispose = render(() => <WorkspaceIdentity name={name()} appearance={appearance()} nodeId="node-a" />, document.body)
  expect(document.body.textContent).toBe('RW')
  setName('Acorn')
  expect(document.body.textContent).toBe('AC')
  setAppearance({ version: 9, kind: 'image', imageId: 'a'.repeat(64) } as unknown as WorkspaceAppearance)
  expect(readBytes).not.toHaveBeenCalled()
  setAppearance(image('c'))
  await Promise.resolve()
  expect(document.body.textContent).toBe('AC')
  expect(document.querySelector('img')).toBeNull()
})
