import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Task } from '@acorn/plugin-api/client'
import { paneRegistry, type Disposable } from '@acorn/plugin-api/testkit/client'

// Which Node's preview URL the pane loads. The pane is drawn the way the shell draws it: through the
// pane registry's layout.

const [nodeId, setNodeId] = createSignal<string | null>('node-a')
const read = vi.fn(async (_url: string, _options: unknown): Promise<unknown> => null)
vi.mock('@acorn/plugin-api/client', () => ({
  activeNodeId: () => nodeId(),
  onPluginFrame: () => () => {},
  previewUrlForClient: (url: string | null) => url,
  readJson: (url: string, options: unknown) => read(url, options),
  remotePreviewBlocked: () => false,
}))
// The page itself is a native view the shell positions, and is not what this file is about.
vi.mock('./PreviewPane', () => ({
  default: (props: { taskId: string; url: string | null }) => (
    <span class="page" data-url={props.url ?? ''}>
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
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  setNodeId('node-b')
  await drawn('same')
  expect(read).toHaveBeenLastCalledWith(expect.any(String), { nodeId: 'node-b' })
  complete({ taskId: 'same', url: 'http://localhost:3000', source: 'config' })
  await new Promise((resolve) => setTimeout(resolve, 0))
  expect(host.querySelector('.page')?.getAttribute('data-url')).toBe('')
})
