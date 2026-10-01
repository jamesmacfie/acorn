import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../../kit/lib/state/registry'
import { clientScheduleRegistry, startClientSchedules } from './schedules'

const [workflowsAvailable, setWorkflowsAvailable] = createSignal(false)
vi.mock('../../../infra/node/hostCapabilities', () => ({
  hasHostCapability: (requirement?: { plugin: string }) => !requirement || workflowsAvailable(),
}))

let stop: (() => void) | undefined
const registered: Disposable[] = []

afterEach(() => {
  stop?.()
  stop = undefined
  for (const entry of registered.splice(0)) entry.dispose()
  setWorkflowsAvailable(false)
})

describe('client schedules', () => {
  it('starts a plugin schedule when its Node capability arrives after startup and stops it when withdrawn', async () => {
    const run = vi.fn()
    const unsubscribe = vi.fn()
    registered.push(clientScheduleRegistry.register({
      id: 'test.workflow-runs', intervalMs: 120_000, requires: { plugin: 'workflows' },
      run, subscribe: () => unsubscribe,
    }))
    stop = startClientSchedules()
    await Promise.resolve()
    expect(run).not.toHaveBeenCalled()

    setWorkflowsAvailable(true)
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())

    setWorkflowsAvailable(false)
    await vi.waitFor(() => expect(unsubscribe).toHaveBeenCalledOnce())
  })

  it('starts a schedule registered after the scheduler is already running', async () => {
    const run = vi.fn()
    stop = startClientSchedules()
    registered.push(clientScheduleRegistry.register({ id: 'test.late', intervalMs: 120_000, run }))

    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce())
  })
})
