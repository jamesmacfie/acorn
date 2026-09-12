// Guards event + poll driven refreshes against out-of-order completion. Only the newest invocation
// may commit, so a slow earlier request cannot overwrite a fresher snapshot.
export function latestOnly<Args extends unknown[], Result>(
  load: (...args: Args) => Promise<Result>,
  commit: (result: Result) => void,
): (...args: Args) => Promise<void> {
  let generation = 0
  return async (...args: Args) => {
    const mine = ++generation
    const result = await load(...args)
    if (mine === generation) commit(result)
  }
}
