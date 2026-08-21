import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRoot } from 'solid-js'
import { createDeviceFlow, type DeviceFlowController } from './deviceFlow'
import { integrationFlowRegistry, type DeviceFlowPoll, type DeviceFlowStart } from '../registries/integrationFlows'

const STARTED: DeviceFlowStart = {
  deviceCode: 'device-code',
  userCode: 'ACRN-4321',
  verificationUri: 'https://github.com/login/device',
  expiresIn: 900,
  interval: 5,
}

// Pacing is the only thing worth testing here: polling faster than the advertised interval, or
// ignoring slow_down, is how a device grant quietly stops working, and nothing in the type system
// catches it.
describe('createDeviceFlow', () => {
  let polls: DeviceFlowPoll[] = []
  let pollCalls = 0
  let connected = 0
  let unregister = () => {}
  let disposeRoot = () => {}

  beforeEach(() => {
    vi.useFakeTimers()
    polls = []
    pollCalls = 0
    connected = 0
    unregister = integrationFlowRegistry.register({
      id: 'test-provider',
      deviceFlow: {
        start: async () => STARTED,
        poll: async () => {
          pollCalls += 1
          return polls.shift() ?? { status: 'pending' }
        },
      },
    }).dispose
  })

  afterEach(() => {
    disposeRoot()
    unregister()
    vi.useRealTimers()
  })

  const run = (fn: (flow: DeviceFlowController) => Promise<void>) =>
    createRoot(async (disposer) => {
      disposeRoot = disposer
      await fn(createDeviceFlow(() => 'test-provider', () => { connected += 1 }))
    })

  it('waits the advertised interval before the first poll', async () => {
    await run(async (flow) => {
      await flow.start()
      expect(flow.device()?.userCode).toBe('ACRN-4321')

      await vi.advanceTimersByTimeAsync(4_999)
      expect(pollCalls).toBe(0)

      await vi.advanceTimersByTimeAsync(1)
      expect(pollCalls).toBe(1)
    })
  })

  it('adds five seconds to the interval when the provider says slow_down', async () => {
    polls = [{ status: 'pending', slowDown: true }]
    await run(async (flow) => {
      await flow.start()

      await vi.advanceTimersByTimeAsync(5_000)
      expect(pollCalls).toBe(1)

      // The old 5s cadence would have fired again by now. The widened one must not have.
      await vi.advanceTimersByTimeAsync(5_000)
      expect(pollCalls).toBe(1)

      await vi.advanceTimersByTimeAsync(5_000)
      expect(pollCalls).toBe(2)
    })
  })

  it('gives up once the grant has expired', async () => {
    await run(async (flow) => {
      await flow.start()
      await vi.advanceTimersByTimeAsync(STARTED.expiresIn * 1_000 + 5_000)
      expect(flow.device()).toBeNull()
      expect(flow.error()).toBe('That code expired. Start again.')
    })
  })

  it('reports a declined request without retrying', async () => {
    polls = [{ status: 'denied' }]
    await run(async (flow) => {
      await flow.start()
      await vi.advanceTimersByTimeAsync(5_000)
      expect(flow.error()).toBe('That request was declined.')

      await vi.advanceTimersByTimeAsync(60_000)
      expect(pollCalls).toBe(1)
    })
  })

  it('calls onConnected once the token arrives, then stops polling', async () => {
    polls = [{ status: 'pending' }, { status: 'connected' }]
    await run(async (flow) => {
      await flow.start()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(connected).toBe(1)
      expect(flow.device()).toBeNull()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(pollCalls).toBe(2)
    })
  })

  it('cancel stops the poller', async () => {
    await run(async (flow) => {
      await flow.start()
      flow.cancel()
      expect(flow.device()).toBeNull()

      await vi.advanceTimersByTimeAsync(60_000)
      expect(pollCalls).toBe(0)
    })
  })
})
