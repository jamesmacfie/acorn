type Job = { start(): void; cancel(): void }
type Queue = { active: boolean; pending: Job[] }
const queues = new Map<string, Queue>()

// HTTP records can be edited from distinct project/task/settings models. Join ordering only; every job
// keeps its own live authority and payload. A cancelled pending job drops those references immediately.
export function serializeHttpWrite<T>(identity: string, signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let queue = queues.get(identity)
  if (!queue) { queue = { active: false, pending: [] }; queues.set(identity, queue) }
  const owner = queue
  return new Promise<T>((resolve, reject) => {
    let run: (() => Promise<T>) | undefined = work
    let started = false
    const release = () => {
      owner.active = false
      const next = owner.pending.shift()
      if (next) next.start()
      else queues.delete(identity)
    }
    const job: Job = {
      start: () => {
        started = true
        owner.active = true
        signal.removeEventListener('abort', job.cancel)
        const invoke = run!
        run = undefined
        void (async () => {
          try { signal.throwIfAborted(); resolve(await invoke()) }
          catch (error) { reject(error) }
          finally { release() }
        })()
      },
      cancel: () => {
        if (started) return
        run = undefined
        const index = owner.pending.indexOf(job)
        if (index >= 0) owner.pending.splice(index, 1)
        signal.removeEventListener('abort', job.cancel)
        reject(signal.reason)
      },
    }
    if (owner.active) {
      owner.pending.push(job)
      signal.addEventListener('abort', job.cancel, { once: true })
    } else job.start()
  })
}
