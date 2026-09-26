// Map over items with at most `limit` calls in flight, results in item order. A pull request with 400
// review threads must not become 400 simultaneous GitHub requests, and GitHub allows 100 concurrent
// requests per account across REST and GraphQL together.
//
// The first throw rejects the whole map and stops new items starting. Calls already in flight finish
// on their own; nothing waits for them.
export async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  let failed = false
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++
      try {
        out[index] = await run(items[index]!, index)
      } catch (error) {
        failed = true
        throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
