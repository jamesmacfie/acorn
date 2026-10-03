const SHARED_READ_MS = 5_000
const shared = new Map<string, { until: number; value: Promise<unknown> }>()

/** One short-lived result per authorized and resolved read. The caller supplies the full key. */
export async function dashboardSharedRead<T>(key: string, load: () => Promise<T>): Promise<T> {
  const cached = shared.get(key)
  if (cached && cached.until > Date.now()) return cached.value as Promise<T>
  if (shared.size > 1000) for (const [entryKey, entry] of shared) if (entry.until <= Date.now()) shared.delete(entryKey)
  const value = load()
  shared.set(key, { until: Date.now() + SHARED_READ_MS, value })
  try { return await value }
  catch (error) { shared.delete(key); throw error }
}

export function clearDashboardReadCache(): void { shared.clear() }
