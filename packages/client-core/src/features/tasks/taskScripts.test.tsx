import { render } from 'solid-js/web'
import { afterEach, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { taskScriptsKey, type TaskScriptSnapshot, type TaskScriptsStatus } from '@acorn/protocol/taskScripts.ts'

const readJson = vi.hoisted(() => vi.fn())
vi.mock('../../infra/node/apiClient', async (original) => ({
  ...(await original<typeof import('../../infra/node/apiClient')>()),
  readJson,
}))
const { ApiError } = await import('../../infra/node/apiClient')
const { createTaskScriptsBatch } = await import('./taskScripts')

const snapshot = (taskId: string, phase: 'setup' | 'teardown'): TaskScriptSnapshot => ({
  taskId,
  phase,
  generation: 0,
  attemptId: null,
  state: 'not_started',
  reason: 'not_requested',
  terminalSessionId: null,
  requestedAt: null,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  outputAvailable: false,
  outputTruncated: false,
})
const status = (taskId: string): TaskScriptsStatus => ({
  taskId,
  generation: 0,
  archiveInProgress: false,
  setup: snapshot(taskId, 'setup'),
  teardown: snapshot(taskId, 'teardown'),
  setupRunnable: false,
  attempts: [],
  attemptsTruncated: false,
})
const idsOf = (url: string) => new URL(url, 'http://node').searchParams.get('ids')!.split(',')

let dispose: (() => void) | undefined
afterEach(() => {
  dispose?.()
  readJson.mockReset()
})

const mount = (ids: string[]) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        {(() => {
          createTaskScriptsBatch(() => ids)
          return null
        })()}
      </QueryClientProvider>
    ),
    document.createElement('div'),
  )
  return client
}

it("splits a long list into reads of a hundred, and files each task's entry under its own key", async () => {
  readJson.mockImplementation(async (url: string) => Object.fromEntries(idsOf(url).map((id) => [id, status(id)])))
  const ids = Array.from({ length: 150 }, (_, index) => `t${String(index).padStart(3, '0')}`)
  const client = mount(ids)
  await vi.waitFor(() => expect(client.getQueryData([...taskScriptsKey, 't149'])).toEqual(status('t149')))
  expect(readJson.mock.calls.map(([url]) => idsOf(url).length)).toEqual([100, 50])
})

it('asks task by task when the Node has no batched route, and leaves out a task it could not read', async () => {
  readJson.mockImplementation(async (url: string) => {
    if (url.startsWith('/v1/core/task-scripts')) throw new ApiError('not found', 404)
    if (url.includes('/gone/')) throw new ApiError('not found', 404)
    return status(decodeURIComponent(url.split('/')[4]!))
  })
  const client = mount(['own', 'gone'])
  await vi.waitFor(() => expect(client.getQueryData([...taskScriptsKey, 'own'])).toEqual(status('own')))
  expect(client.getQueryData([...taskScriptsKey, 'gone'])).toBeUndefined()
})
