import { latestSignal } from './latestSignal.ts'

// Guards event + poll driven refreshes against out-of-order completion. Only the newest invocation
// may commit, so a slow earlier request cannot overwrite a fresher snapshot. A flow with more than
// one await uses `latestSignal` directly.
export function latestOnly<Args extends unknown[], Result>(
  load: (...args: Args) => Promise<Result>,
  commit: (result: Result) => void,
): (...args: Args) => Promise<void> {
  const latest = latestSignal()
  return async (...args: Args) => {
    const signal = latest.next()
    const result = await load(...args)
    if (!signal.aborted) commit(result)
  }
}
