// A lifetime for async work that a newer start makes stale. `next()` aborts the previous signal and
// returns a fresh one, so a multi-step flow checks `signal.aborted` after each await. `abort()`
// cancels the current flow without starting another, for a reset or an unmount.
export type LatestSignal = {
  readonly signal: AbortSignal
  next(): AbortSignal
  abort(): void
}

export function latestSignal(): LatestSignal {
  let controller = new AbortController()
  return {
    get signal() { return controller.signal },
    next() {
      controller.abort()
      controller = new AbortController()
      return controller.signal
    },
    abort() { controller.abort() },
  }
}
