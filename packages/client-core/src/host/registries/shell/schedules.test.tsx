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

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

it('joins 30 edges and honors another invalidation during the follow-up', async () => {
  let refresh!: () => void
  let calls = 0, active = 0, peak = 0
  const release: (() => void)[] = []
  registered.push(clientScheduleRegistry.register({ id: 'test.wave', intervalMs: 120_000,
    run: async () => { calls++; peak = Math.max(peak, ++active); await new Promise<void>(yes => release.push(yes)); active-- },
    subscribe: edge => { refresh = edge; return () => {} },
  }))
  stop = startClientSchedules(); await settle()
  for (let i = 0; i < 30; i++) refresh()
  expect(calls).toBe(1)
  release.shift()!(); await settle()
  expect(calls).toBe(2)
  refresh(); release.shift()!(); await settle()
  expect(calls).toBe(3)
  release.shift()!(); await settle()
  expect(active).toBe(0)
  expect(peak).toBe(1)
})

it('skips hidden edges and discards pending follow-ups when disposed', async () => {
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  let refresh!: () => void, release!: () => void
  const run = vi.fn(() => new Promise<void>(yes => { release = yes }))
  registered.push(clientScheduleRegistry.register({ id: 'test.dispose', intervalMs: 120_000, run,
    subscribe: edge => { refresh = edge; return () => {} },
  }))
  stop = startClientSchedules(); await settle()
  Object.defineProperty(document, 'hidden', { configurable: true, value: true })
  refresh(); release(); await settle()
  expect(run).toHaveBeenCalledOnce()
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  document.dispatchEvent(new Event('visibilitychange')); await settle()
  expect(run).toHaveBeenCalledTimes(2)
  refresh(); stop(); stop = undefined; release(); await settle(); refresh()
  expect(run).toHaveBeenCalledTimes(2)
})

it('catches synchronous throws and rejections and retries on the next edge', async () => {
  let refresh!: () => void
  const run = vi.fn().mockImplementationOnce(() => { throw new Error('sync') })
    .mockRejectedValueOnce(new Error('async')).mockResolvedValue(undefined)
  registered.push(clientScheduleRegistry.register({ id: 'test.errors', intervalMs: 120_000, run,
    subscribe: edge => { refresh = edge; return () => {} },
  }))
  stop = startClientSchedules(); await settle()
  refresh(); await settle(); refresh(); await settle()
  expect(run).toHaveBeenCalledTimes(3)
})

it('does not retire independent contributions when another registry entry changes', async () => {
  const unsubscribe = vi.fn()
  const run = vi.fn()
  registered.push(clientScheduleRegistry.register({ id: 'test.independent', intervalMs: 120_000, run, subscribe: () => unsubscribe }))
  stop = startClientSchedules(); await settle()
  const other = clientScheduleRegistry.register({ id: 'test.other', intervalMs: 120_000, run: () => {} })
  await settle(); other.dispose(); await settle()
  expect(run).toHaveBeenCalledOnce()
  expect(unsubscribe).not.toHaveBeenCalled()
})

it('leaves another scheduler owner running after one departs', async () => {
  const releases: (() => void)[] = []
  const run = vi.fn(() => new Promise<void>(yes => { releases.push(yes) }))
  registered.push(clientScheduleRegistry.register({ id: 'test.two', intervalMs: 120_000, run }))
  stop = startClientSchedules()
  const second = startClientSchedules()
  await settle(); stop(); stop = undefined
  releases.shift()!(); releases.shift()!(); await settle()
  expect(run).toHaveBeenCalledTimes(2)
  second()
})

it('retires a dirty follow-up when the contribution loses its capability', async () => {
  setWorkflowsAvailable(true)
  let refresh!: () => void, release!: () => void
  const unsubscribe = vi.fn()
  const run = vi.fn(() => new Promise<void>(yes => { release = yes }))
  registered.push(clientScheduleRegistry.register({ id: 'test.withdraw', intervalMs: 120_000, requires: { plugin: 'workflows' },
    run, subscribe: edge => { refresh = edge; return unsubscribe },
  }))
  stop = startClientSchedules(); await settle(); refresh()
  setWorkflowsAvailable(false); await settle(); release(); await settle(); refresh()
  expect(run).toHaveBeenCalledOnce()
  expect(unsubscribe).toHaveBeenCalledOnce()
})
