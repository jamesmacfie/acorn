import { createSignal, type Setter } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import type { TaskScriptSnapshot, TaskScriptsStatus } from '@acorn/protocol/taskScripts.ts'
import { TaskScriptDetails } from './TaskScriptDetails'

const fixture = vi.hoisted(() => ({ current: undefined as undefined | (() => TaskScriptsStatus), freshness: 'live', paths: [] as string[] }))
vi.mock('./taskScripts', async importOriginal => ({
  ...await importOriginal<typeof import('./taskScripts')>(),
  createTaskScripts: () => ({ query: { get data() { return fixture.current?.() } }, freshness: () => fixture.freshness }),
}))
vi.mock('./agentSessions', () => ({ sessionSummaries: () => [], focusSession: () => {} }))
vi.mock('../../infra/node/apiClient', () => ({ readJson: async (path: string) => {
  fixture.paths.push(path)
  return { snapshot: fixture.current!().setup, output: 'last diagnostic\n', available: true, truncated: true, retainedBytes: 65536, returnedBytes: 16 }
} }))
const setup: TaskScriptSnapshot = { taskId: 'task', phase: 'setup', generation: 2, attemptId: 'attempt', state: 'running', reason: 'process_started', terminalSessionId: 'terminal', requestedAt: 1, startedAt: Date.now(), finishedAt: null, exitCode: null, outputAvailable: true, outputTruncated: false }
const status = (): TaskScriptsStatus => ({ taskId: 'task', generation: 2, archiveInProgress: true, setup, teardown: { ...setup, phase: 'teardown', state: 'not_started', reason: 'not_requested', attemptId: null, startedAt: null }, attempts: [setup], attemptsTruncated: false })
let host: HTMLElement
let dispose: (() => void) | undefined
function mount() {
  host = document.createElement('div'); document.body.append(host)
  let update!: Setter<TaskScriptsStatus>
  dispose = render(() => {
    const [current, setCurrent] = createSignal(status()); fixture.current = current; update = setCurrent
    return <TaskScriptDetails taskId="task" />
  }, host)
  return update
}
afterEach(() => { dispose?.(); host?.remove(); fixture.current = undefined; fixture.freshness = 'live'; fixture.paths.length = 0 })
it('allows running diagnostics, reflects a later outcome in the open dialog, and retains archive progress', async () => {
  const update = mount()
  expect(fixture.paths).toEqual([])
  host.querySelector<HTMLButtonElement>('[aria-label^="Setup running"]')!.click()
  await vi.waitFor(() => expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Earlier output omitted'))
  expect(fixture.paths[0]).toContain('/scripts/logs?phase=setup&attemptId=attempt&tailLines=100')
  const completed = { ...setup, state: 'failed' as const, reason: 'nonzero_exit' as const, exitCode: 1, finishedAt: Date.now() }
  update({ ...status(), setup: completed, attempts: [completed] })
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Setup failed (exit 1)')
  expect(host.querySelector('[aria-label="Archive in progress"]')).not.toBeNull()
})
it('labels offline cached running state as a snapshot rather than a live process', () => {
  fixture.freshness = 'offline'; mount()
  host.querySelector<HTMLButtonElement>('[aria-label^="Setup running"]')!.click()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('cached running state does not confirm a live process')
})
