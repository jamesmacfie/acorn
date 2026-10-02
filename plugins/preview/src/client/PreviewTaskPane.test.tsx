import { createMemo, createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { paneRegistry, type Disposable } from '@acorn/plugin-api/testkit/client'

// Which task's preview tunnels close when the reader leaves a task. The pane is drawn the way the
// shell draws it: through the pane registry's layout, under a `<Show keyed>` on the active task id,
// fed by a memo that already holds the next task by the time the old view is disposed
// (apps/desktop/src/client/App.tsx).

const closeTunnelsForTask = vi.fn()
const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const read = vi.fn(async (_url: string, _options: unknown): Promise<unknown> => null)
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => nodeId(),
  closeTunnelsForTask: (taskId: string, nodeId: string | null) => closeTunnelsForTask(taskId, nodeId),
  onPluginFrame: () => () => {},
  previewUrlForClient: (url: string | null) => url,
  readJson: (url: string, options: unknown) => read(url, options),
  remotePreviewBlocked: () => false,
}))
// The page itself is a native view the shell positions, and is not what this file is about.
vi.mock('./PreviewPane', () => ({ default: (props: { taskId: string; url: string | null }) => <span class="page" data-url={props.url ?? ""}>{props.taskId}</span> }))

const { previewPaneContribution } = await import('./paneContribution')

const task = (id: string): Task => ({ id, status: 'active' } as Task)

let host: HTMLElement
let registration: Disposable
const disposers: (() => void)[] = []

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  registration = paneRegistry.register(previewPaneContribution)
  closeTunnelsForTask.mockClear()
  read.mockReset().mockResolvedValue(null)
  setNodeId('node-a')
})

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose()
  registration.dispose()
  host.remove()
})

const pane = () => paneRegistry.get('preview')!.component

// The layout and the region are `lazy`, so the pane draws a few ticks after it is asked for. The
// first draw in the file imports them cold, and under the full suite's load that took over the
// default second.
const drawn = (taskId: string) =>
  vi.waitFor(() => expect(host.querySelector('.page')?.textContent).toBe(taskId), { timeout: 5_000 })

it('closes the tunnels of the task being left, not the one being opened', async () => {
  const [activeId, setActiveId] = createSignal('a')
  const Pane = pane()
  disposers.push(render(() => {
    const current = createMemo(() => task(activeId()))
    // The child takes an argument, as App's does. `Show` only rebuilds a child function that takes one,
    // so a `() =>` child would keep the old pane alive and this test would pass for the wrong reason.
    return <Show keyed when={activeId()}>{(_id) => <Pane task={current()} />}</Show>
  }, host))
  await drawn('a')

  setActiveId('b')
  expect(closeTunnelsForTask.mock.calls).toEqual([['a', 'node-a']])
})

// The shell remounts the pane per task, so this is the case no host produces today. Covered because
// the layout host is written to hand a live pane a new task (registries/panes/panes.ts).
it('closes the previous task when one pane is handed another task', async () => {
  const [current, setCurrent] = createSignal(task('a'))
  const Pane = pane()
  disposers.push(render(() => <Pane task={current()} />, host))
  await drawn('a')

  // A refreshed row for the same task is not a task switch.
  setCurrent(task('a'))
  expect(closeTunnelsForTask).not.toHaveBeenCalled()

  setCurrent(task('b'))
  expect(closeTunnelsForTask.mock.calls).toEqual([['a', 'node-a']])
  disposers.pop()!()
  expect(closeTunnelsForTask.mock.calls).toEqual([['a', 'node-a'], ['b', 'node-a']])
})

it('binds same-ID task reads and cleanup to the originating Node and rejects late URLs', async () => {
  let complete!: (value: unknown) => void
  read.mockImplementationOnce(() => new Promise((resolve) => { complete = resolve }))
  const Pane = pane()
  disposers.push(render(() => <Pane task={task('same')} />, host))
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  setNodeId('node-b')
  await drawn('same')
  expect(closeTunnelsForTask).toHaveBeenCalledWith('same', 'node-a')
  expect(read).toHaveBeenLastCalledWith(expect.any(String), { nodeId: 'node-b' })
  complete({ taskId: 'same', url: 'http://localhost:3000', source: 'config' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(host.querySelector('.page')?.getAttribute('data-url')).toBe('')
  disposers.pop()!()
  expect(closeTunnelsForTask).toHaveBeenLastCalledWith('same', 'node-b')
})
