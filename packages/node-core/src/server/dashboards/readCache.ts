const SHARED_READ_MS = 5_000
const shared = new Map<string, { until: number; value: Promise<unknown> }>()

/** One short-lived result per authorized and resolved read. The caller supplies the full key.
 *
 *  A read runs under the signal of the caller that started it, so when that caller goes away the read
 *  fails for every caller that joined it. `rejoin` says whether an error was that kind of failure. A
 *  caller that joined a read and got one starts a read of its own, once. */
export async function dashboardSharedRead<T>(key: string, load: () => Promise<T>, rejoin?: (error: unknown) => boolean): Promise<T> {
  const cached = shared.get(key)
  if (cached && cached.until > Date.now()) {
    try { return await (cached.value as Promise<T>) }
    catch (error) {
      if (!rejoin?.(error)) throw error
      return dashboardSharedRead(key, load)
    }
  }
  if (shared.size > 1000) for (const [entryKey, entry] of shared) if (entry.until <= Date.now()) shared.delete(entryKey)
  const value = load()
  shared.set(key, { until: Date.now() + SHARED_READ_MS, value })
  try { return await value }
  catch (error) { shared.delete(key); throw error }
}

export function clearDashboardReadCache(): void { shared.clear() }
