import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { paneRegistry, type Disposable } from '@acorn/plugin-api/testkit/client'

// Which Node's preview URL the pane loads. The pane is drawn the way the shell draws it: through the
// pane registry's layout.

const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const read = vi.fn(async (_url: string, _options: unknown): Promise<unknown> => null)
// The local Node unless a test says otherwise.
let target: (url: string, nodeId: string | null) => unknown = (url) => ({ kind: 'direct', url })
const open = vi.fn(async (_nodeId: string, _taskId: string, _path: string) => ({
  origin: 'http://127.0.0.1:50000',
  entry: 'http://127.0.0.1:50000/__acorn/preview?key=k&to=%2F',
}))
const blockedListeners: ((state: { taskId: string; url: string }) => void)[] = []
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => nodeId(),
  onPluginFrame: () => () => {},
  previewProxy: () => ({ open, onBlocked: (cb: never) => (blockedListeners.push(cb), () => {}) }),
  previewTarget: (url: string, nodeId: string | null) => target(url, nodeId),
  readJson: (url: string, options: unknown) => read(url, options),
  remotePreviewBlocked: () => false,
}))
// The page itself is a native view the shell positions, and is not what this file is about.
vi.mock('./PreviewPane', () => ({
  default: (props: {
    taskId: string
    url: string | null
    blockedReason?: string | null
    blockedNavigation?: string | null
  }) => (
    <span
      class="page"
      data-url={props.url ?? ''}
      data-blocked={props.blockedReason ?? ''}
      data-refused={props.blockedNavigation ?? ''}
    >
      {props.taskId}
    </span>
  ),
}))

const { previewPaneContribution } = await import('./paneContribution')

const task = (id: string): Task => ({ id, status: 'active' }) as Task

let host: HTMLElement
let registration: Disposable
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  registration = paneRegistry.register(previewPaneContribution)
  read.mockReset().mockResolvedValue(null)
  open.mockClear()
  blockedListeners.length = 0
  target = (url) => ({ kind: 'direct', url })
  setNodeId('node-a')
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  registration.dispose()
  host.remove()
})

const pane = () => paneRegistry.get('preview')!.component

// The layout and the region are `lazy`, so the pane draws a few ticks after it is asked for. The
// first draw in the file imports them cold, and under the full suite's load that can take longer than
// the default second.
const drawn = (taskId: string) =>
  vi.waitFor(() => expect(host.querySelector('.page')?.textContent).toBe(taskId), { timeout: 5_000 })

it('binds same-ID task reads to the originating Node and rejects late URLs', async () => {
  let complete!: (value: unknown) => void
  read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        complete = resolve
      }),
  )
  const Pane = pane()
  disposers.push(render(() => <Pane task={task('same')} />, host))
  // The pane reads only after its cold lazy draw, so this wait needs the same allowance as `drawn`.
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce(), { timeout: 5_000 })
  setNodeId('node-b')
  await drawn('same')
  expect(read).toHaveBeenLastCalledWith(expect.any(String), { nodeId: 'node-b' })
  complete({ taskId: 'same', url: 'http://localhost:3000', source: 'config' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(host.querySelector('.page')?.getAttribute('data-url')).toBe('')
})

const page = () => host.querySelector('.page')!

it("loads a remote Node's app through its listener, opened once for the task", async () => {
  target = (_url, nodeId) => ({ kind: 'proxied', nodeId, path: '/app' })
  read.mockResolvedValue({ taskId: 'remote', url: 'http://localhost:5173/app', source: 'config' })
  const Pane = pane()
  disposers.push(render(() => <Pane task={task('remote')} />, host))
  await vi.waitFor(() => expect(page().getAttribute('data-url')).toMatch(/__acorn\/preview/), { timeout: 5_000 })
  expect(open).toHaveBeenCalledExactlyOnceWith('node-a', 'remote', '/app')

  // A navigation the shell refused shows its address, for this task only.
  for (const listener of blockedListeners) listener({ taskId: 'other', url: 'http://192.168.1.1/' })
  expect(page().getAttribute('data-refused')).toBe('')
  for (const listener of blockedListeners) listener({ taskId: 'remote', url: 'http://192.168.1.1/' })
  expect(page().getAttribute('data-refused')).toBe('http://192.168.1.1/')
})

it('says why a remote address is blocked, and opens nothing', async () => {
  target = () => ({ kind: 'blocked', reason: 'not-loopback' })
  read.mockResolvedValue({ taskId: 'remote', url: 'http://192.168.1.1/', source: 'config' })
  const Pane = pane()
  disposers.push(render(() => <Pane task={task('remote')} />, host))
  await vi.waitFor(() => expect(page().getAttribute('data-blocked')).toBe('not-loopback'), { timeout: 5_000 })
  expect(page().getAttribute('data-url')).toBe('')
  expect(open).not.toHaveBeenCalled()
})
