import { BridgeError } from '@acorn/plugin-api/node'

/** At most two history requests run Git at once; one revision can spawn two parallel reads. */
export function readGate() {
  let running = 0
  const waiting: Array<() => void> = []
  const release = () => {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
  return async <T>(signal: AbortSignal, read: () => Promise<T>): Promise<T> => {
    if (signal.aborted) throw signal.reason
    if (running < 2) running++
    else {
      if (waiting.length >= 32) throw new BridgeError(422, 'git_read_busy', 'Too many Git reads are waiting. Try again.')
      await new Promise<void>((resolve, reject) => {
        const ready = () => { signal.removeEventListener('abort', abort); resolve() }
        const abort = () => { waiting.splice(waiting.indexOf(ready), 1); reject(signal.reason) }
        waiting.push(ready)
        signal.addEventListener('abort', abort, { once: true })
      })
    }
    if (signal.aborted) { release(); throw signal.reason }
    try { return await read() }
    finally { release() }
  }
}
