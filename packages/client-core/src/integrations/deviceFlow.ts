import { createSignal, onCleanup, type Accessor } from 'solid-js'
import { integrationFlowRegistry, type DeviceFlowStart } from '../registries/integrationFlows'

// Device authorization grant (RFC 8628) for a provider whose descriptor says `kind: 'device-flow'`.
// The node performs the token exchange; this only paces the polling — which is the whole reason it is
// a shared module rather than a branch inside one settings component. Both the Integrations page and
// first-run onboarding need identical pacing, and getting it wrong (polling faster than the
// advertised interval, ignoring slow_down) is how a connection quietly stops working.
//
// Deliberately free of JSX so it can sit on the @acorn/plugin-api/client barrel: a plugin's
// node-environment test suite must be able to import that barrel.

export type DeviceFlowController = {
  /** The started grant while it is in flight, else null. */
  device: Accessor<DeviceFlowStart | null>
  error: Accessor<string>
  /** True while starting. Polling is not "busy" — the caller keeps its UI interactive. */
  busy: Accessor<boolean>
  start: () => Promise<void>
  cancel: () => void
}

/** GitHub's slow_down directive means "add 5 seconds to the interval", not "you erred". */
const SLOW_DOWN_STEP_MS = 5_000

export function createDeviceFlow(
  providerId: () => string | undefined,
  onConnected: () => void | Promise<void>,
): DeviceFlowController {
  const [device, setDevice] = createSignal<DeviceFlowStart | null>(null)
  const [error, setError] = createSignal('')
  const [busy, setBusy] = createSignal(false)

  let poller: ReturnType<typeof setTimeout> | undefined
  const stopPolling = () => clearTimeout(poller)
  onCleanup(stopPolling)

  const flow = () => {
    const id = providerId()
    return id ? integrationFlowRegistry.get(id)?.deviceFlow : undefined
  }

  const poll = (started: DeviceFlowStart, delay: number, deadline: number) => {
    stopPolling()
    poller = setTimeout(async () => {
      if (Date.now() > deadline) {
        setDevice(null)
        setError('That code expired. Start again.')
        return
      }
      try {
        const active = flow()
        if (!active) throw new Error('This provider does not expose a device connection flow.')
        const result = await active.poll(started.deviceCode)
        if (result.status === 'connected') {
          setDevice(null)
          await onConnected()
          return
        }
        if (result.status !== 'pending') {
          setDevice(null)
          setError(result.status === 'denied' ? 'That request was declined.' : 'That code expired. Start again.')
          return
        }
        poll(started, result.slowDown ? delay + SLOW_DOWN_STEP_MS : delay, deadline)
      } catch (cause) {
        setDevice(null)
        setError(cause instanceof Error ? cause.message : 'Could not finish connecting.')
      }
    }, delay)
  }

  const start = async () => {
    setBusy(true)
    setError('')
    try {
      const active = flow()
      if (!active) throw new Error('This provider does not expose a device connection flow.')
      const started = await active.start()
      setDevice(started)
      // `interval` is the provider's, honoured exactly — polling faster earns a slow_down and,
      // eventually, nothing.
      poll(started, started.interval * 1_000, Date.now() + started.expiresIn * 1_000)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the connection.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = () => {
    stopPolling()
    setDevice(null)
  }

  return { device, error, busy, start, cancel }
}
