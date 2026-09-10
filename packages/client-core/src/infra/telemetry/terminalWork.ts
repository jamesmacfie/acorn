import { recordDuration, recordSample, telemetryEnabled } from './emitter'

/** Completion is xterm's parser callback, not the time needed to enqueue a chunk. */
export function terminalWork() {
  let pending = 0
  return (size: number): (() => void) => {
    if (!telemetryEnabled()) return () => {}
    const from = performance.now()
    pending += size
    recordSample('core', 'terminal.output.size', size)
    recordSample('core', 'terminal.pending.size', pending)
    let done = false
    return () => {
      if (done) return
      done = true
      pending -= size
      recordDuration('core', 'terminal.write', performance.now() - from)
    }
  }
}
