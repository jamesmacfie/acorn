import { describe, expect, it, vi } from 'vitest'
import { createRendererWatchdog } from './rendererWatchdog'

const activity = { owner: 'agents', operation: 'agents.session.open', traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) }
function fixture() {
  let time = 0
  let enabled = true
  const report = vi.fn()
  const watch = createRendererWatchdog({ now: () => time, enabled: () => enabled, report })
  return { watch, report, setEnabled: (on: boolean) => { enabled = on },
    advance: (ms: number) => { time += ms; watch.tick() } }
}
describe('renderer watchdog', () => {
  it('reports a permanent renderer stall from the independent helper, once, then recovery', () => {
    const f = fixture()
    f.watch.receive({ active: true, activity })
    for (let i = 0; i < 8; i++) f.advance(1000)
    expect(f.report).toHaveBeenCalledExactlyOnceWith('ui.hang.suspected', { durationMs: 5000, ...activity, contextAgeMs: 5000, operationActive: true })
    f.watch.receive({ active: true, activity: null })
    expect(f.report).toHaveBeenLastCalledWith('ui.hang.recovered', { durationMs: 8000, ...activity, contextAgeMs: 8000, operationActive: true })
  })
  it('retains the last interaction after it completes, marked as historical context', () => {
    const f = fixture()
    f.watch.receive({ active: true, activity })
    f.advance(1000)
    f.watch.receive({ active: true, activity: null })
    for (let i = 0; i < 5; i++) f.advance(1000)
    expect(f.report).toHaveBeenCalledWith('ui.hang.suspected', { durationMs: 5000, ...activity, contextAgeMs: 6000, operationActive: false })
  })
  it('does not confuse sleep or helper starvation with a renderer hang', () => {
    const f = fixture()
    f.watch.receive({ active: true, activity })
    f.advance(60_000)
    for (let i = 0; i < 10; i++) f.advance(1000)
    expect(f.report).not.toHaveBeenCalled()
  })
  it.each(['background', 'consent', 'disconnect'])('disarms on %s', (reason) => {
    const f = fixture()
    f.watch.receive({ active: true, activity })
    if (reason === 'background') f.watch.receive({ active: false, activity: null })
    if (reason === 'consent') f.setEnabled(false)
    if (reason === 'disconnect') f.watch.reset()
    for (let i = 0; i < 10; i++) f.advance(1000)
    expect(f.report).not.toHaveBeenCalled()
  })
  it('rejects unbounded or content-bearing operation names', () => {
    const f = fixture()
    f.watch.receive({ active: true, activity: { ...activity, operation: 'read /private/customer/file.ts' } })
    for (let i = 0; i < 10; i++) f.advance(1000)
    expect(f.report).not.toHaveBeenCalled()
  })
})
