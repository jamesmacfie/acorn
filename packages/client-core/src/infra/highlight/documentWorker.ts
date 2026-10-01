/** Window-owned request lifetimes shared by the two independent document workers. */
export type WorkerResult<T> = { kind: 'value'; value: T } | { kind: 'fallback' } | { kind: 'degraded' }
type Pending<T> = { settle: (result: WorkerResult<T>) => void }
type Generation<T> = {
  worker: Worker | null
  spawning: Promise<void> | null
  dead: 'fallback' | 'degraded' | null
  pending: Map<number, Pending<T>>
}

export function createDocumentWorker<Request extends { id: number }, Response extends { id: number }, Value>(options: {
  load: () => Promise<{ default: new () => Worker }>
  response: (message: Response) => WorkerResult<Value>
  unavailable?: (reason: string) => void
  timeout?: () => void
  pending?: (count: number) => void
}) {
  const fresh = (): Generation<Value> => ({ worker: null, spawning: null, dead: null, pending: new Map() })
  let current = fresh()
  let nextId = 1

  const retire = (generation: Generation<Value>, kind: 'fallback' | 'degraded', reason: string) => {
    if (generation.dead) return
    generation.dead = kind
    const worker = generation.worker
    generation.worker = null
    // A browser termination failure must not strand callers or their deadline timers.
    try { worker?.terminate() } catch { /* The generation is fenced even if termination fails. */ }
    for (const entry of [...generation.pending.values()]) entry.settle({ kind })
    if (kind === 'fallback') { try { options.unavailable?.(reason) } catch { /* Diagnostics do not own settlement. */ } }
  }

  const spawn = (generation: Generation<Value>): Promise<void> => {
    if (generation.spawning) return generation.spawning
    generation.spawning = (async () => {
      if (typeof Worker === 'undefined') {
        retire(generation, 'fallback', 'Worker is unavailable')
        return
      }
      try {
        const Constructor = (await options.load()).default
        if (current !== generation || generation.dead) return
        const worker = new Constructor()
        generation.worker = worker
        worker.onmessage = (event: MessageEvent<Response>) => {
          if (current !== generation || generation.dead || generation.worker !== worker) return
          try {
            const message = event.data
            const entry = generation.pending.get(message.id)
            if (entry) entry.settle(options.response(message))
          } catch { retire(generation, 'fallback', 'invalid worker response') }
        }
        worker.onerror = () => {
          if (current === generation && generation.worker === worker) retire(generation, 'fallback', 'worker script failed to load or run')
        }
      } catch {
        if (current === generation) retire(generation, 'fallback', 'worker import or construction failed')
      }
    })()
    return generation.spawning
  }

  const request = (build: (id: number) => Request): Promise<WorkerResult<Value>> => {
    const generation = current
    if (generation.dead) return Promise.resolve({ kind: generation.dead })
    const id = nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (current !== generation || !generation.pending.has(id)) return
        // Do not replay a potentially pathological batch on the renderer.
        retire(generation, 'degraded', 'request deadline')
        try { options.timeout?.() } catch { /* Diagnostics do not own settlement. */ }
      }, 10_000)
      generation.pending.set(id, { settle: (result) => {
        if (!generation.pending.delete(id)) return
        clearTimeout(timer)
        resolve(result)
      } })
      try { options.pending?.(generation.pending.size) } catch { /* Diagnostics do not own settlement. */ }
      void spawn(generation).then(() => {
        if (current !== generation || generation.dead || !generation.pending.has(id)) return
        try { generation.worker?.postMessage(build(id)) }
        catch { retire(generation, 'fallback', 'worker postMessage failed') }
      }, () => { if (current === generation) retire(generation, 'fallback', 'worker startup failed') })
    })
  }

  const reset = () => {
    retire(current, 'degraded', 'reset')
    current = fresh()
  }
  return { request, reset, workerCount: () => current.worker ? 1 : 0 }
}
