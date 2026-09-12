import { afterEach, expect, it, vi } from 'vitest'
import { _resetClientTelemetry, setTelemetryEnabled, startClientTelemetry, startInteraction } from './emitter'
import { startResponsivenessMonitor } from './responsiveness'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); dispose = undefined; _resetClientTelemetry(); vi.restoreAllMocks(); vi.useRealTimers() })
it('sends operation context synchronously and disarms on blur and consent revocation', () => {
  vi.useFakeTimers()
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  const focused = vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  const send = vi.fn()
  startClientTelemetry({ runtime: 'renderer', post: async () => {} })
  dispose = startResponsivenessMonitor(send)
  expect(send).not.toHaveBeenCalled()
  setTelemetryEnabled(true)
  const span = startInteraction('agents', { name: 'agents.session.open' })
  expect(send).toHaveBeenLastCalledWith({ active: true, activity: { owner: 'agents', operation: 'agents.session.open', traceId: span.traceId, spanId: span.spanId } })
  focused.mockReturnValue(false)
  window.dispatchEvent(new Event('blur'))
  expect(send).toHaveBeenLastCalledWith({ active: false, activity: null })
  focused.mockReturnValue(true)
  window.dispatchEvent(new Event('focus'))
  setTelemetryEnabled(false)
  expect(send).toHaveBeenLastCalledWith({ active: false, activity: null })
  const count = send.mock.calls.length
  vi.advanceTimersByTime(10_000)
  expect(send).toHaveBeenCalledTimes(count)
})
it('a broken diagnostic transport cannot prevent an interaction', () => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible')
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  startClientTelemetry({ runtime: 'renderer', post: async () => {} })
  setTelemetryEnabled(true)
  expect(() => { dispose = startResponsivenessMonitor(() => { throw new Error('closed socket') }) }).not.toThrow()
  expect(() => startInteraction('agents', { name: 'agents.session.open' })).not.toThrow()
})
