import { afterEach, expect, it, vi } from 'vitest'
const end = vi.fn()
const activeTaskId = vi.fn((): string | null => 'shown')
vi.mock('@acorn/plugin-api/client', () => ({
  activeTaskId: () => activeTaskId(),
  telemetryFor: () => ({ startOperation: () => ({ traceId: 'trace', spanId: 'span', end }) }),
}))
const { claimAgentSelection, markAgentSelection, startAgentView } = await import('./agentTelemetry')
afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
const stubFrames = () => {
  const frames: FrameRequestCallback[] = []
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    frames.push(cb)
    return frames.length
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  return frames
}
it('waits for content and two frames, then ends once', () => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'visible' })
  const frames = stubFrames()
  const view = startAgentView('agents.session.open')
  expect(end).not.toHaveBeenCalled()
  view.ready()
  view.ready()
  frames.shift()!(0)
  vi.advanceTimersByTime(1_000)
  expect(end).not.toHaveBeenCalled()
  frames.shift()!(16)
  expect(end).toHaveBeenCalledExactlyOnceWith('ok', { outcome: 'ready' }, undefined)
  view.dispose()
  vi.advanceTimersByTime(30_000)
  expect(end).toHaveBeenCalledOnce()
})
it.each(['error', 'cancelled', 'timeout'])('records %s instead of readiness', (outcome) => {
  vi.useFakeTimers()
  const view = startAgentView('agents.session.open')
  if (outcome === 'error') view.fail()
  if (outcome === 'cancelled') view.dispose()
  if (outcome === 'timeout') vi.advanceTimersByTime(30_000)
  view.ready()
  expect(end).toHaveBeenCalledExactlyOnceWith(outcome === 'cancelled' ? 'ok' : 'error', { outcome }, undefined)
})
it('ends as ready, tagged hidden, when the content arrives in a hidden window', () => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'hidden' })
  stubFrames()
  const view = startAgentView('agents.session.open')
  view.ready()
  vi.advanceTimersByTime(100)
  expect(end).toHaveBeenCalledExactlyOnceWith('ok', { outcome: 'ready', hidden: true }, undefined)
})
it('records the window visibility and whether the open was claimed on a timeout', () => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'visible' })
  markAgentSelection('shown', 's1')
  claimAgentSelection('s1')
  vi.advanceTimersByTime(30_000)
  expect(end).toHaveBeenCalledExactlyOnceWith(
    'error',
    { outcome: 'timeout', claimed: true, visibility: 'visible' },
    undefined,
  )
})
it('records an unclaimed mark on a timeout', () => {
  vi.useFakeTimers()
  vi.stubGlobal('document', { visibilityState: 'hidden' })
  markAgentSelection('shown', 's1')
  vi.advanceTimersByTime(30_000)
  expect(end).toHaveBeenCalledExactlyOnceWith(
    'error',
    { outcome: 'timeout', claimed: false, visibility: 'hidden' },
    undefined,
  )
})
it('cancels at once a mark for a task that is not on screen', async () => {
  vi.useFakeTimers()
  markAgentSelection('elsewhere', 's1')
  expect(end).not.toHaveBeenCalled()
  await Promise.resolve()
  expect(end).toHaveBeenCalledExactlyOnceWith('ok', { outcome: 'cancelled' }, undefined)
  // That task's conversation, mounting later, measures its own open instead of the cancelled one.
  const view = claimAgentSelection('s1')
  view.ready()
  expect(end).toHaveBeenLastCalledWith('ok', { outcome: 'ready' }, undefined)
  expect(end).toHaveBeenCalledTimes(2)
})
it('keeps a mark for the task on screen for its conversation to claim', async () => {
  vi.useFakeTimers()
  markAgentSelection('shown', 's1')
  await Promise.resolve()
  expect(end).not.toHaveBeenCalled()
  claimAgentSelection('s1').ready()
  expect(end).toHaveBeenCalledExactlyOnceWith('ok', { outcome: 'ready' }, undefined)
})
it('caps a timeout that fired late at the deadline and says it was late', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let now = 1_000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  startAgentView('agents.session.open')
  // The Mac slept, so the timer fires a minute after it was due.
  now += 90_000
  vi.advanceTimersByTime(30_000)
  clock.mockRestore()
  expect(end).toHaveBeenCalledExactlyOnceWith('error', { outcome: 'timeout', late: true }, 31_000)
})
