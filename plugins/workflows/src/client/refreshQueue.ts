/** One read at a time. An invalidation during a snapshot requires another authoritative read. */
export function workflowRefreshQueue(read: () => Promise<void>) {
  let stopped = false
  let dirty = false
  let pending: Promise<void> | undefined
  return {
    refresh(): Promise<void> {
      if (stopped) return Promise.resolve()
      dirty = true
      if (pending) return pending
      pending = (async () => {
        let failure: unknown
        try {
          do {
            dirty = false
            failure = undefined
            try { await read() }
            catch (error) { failure = error }
          } while (dirty && !stopped)
          if (failure !== undefined) throw failure
        } finally { pending = undefined }
      })()
      return pending
    },
    stop(): void { stopped = true; dirty = false },
  }
}
