// Bounded, content-free summaries for repeated work inside an interaction. Counts are calls,
// including workload observations, not time sums (nested timings would double count CPU time).
const interactions = new Map<string, Map<string, number>>()
export function beginInteractionWork(id: string): void {
  if (interactions.size >= 20) interactions.delete(interactions.keys().next().value!)
  interactions.set(id, new Map())
}
export function recordInteractionWork(id: string | undefined, operation: string): void {
  if (!id || operation.startsWith('ui.') || operation.startsWith('runtime.')) return
  const counts = interactions.get(id)
  if (!counts || (!counts.has(operation) && counts.size >= 50)) return
  counts.set(operation, (counts.get(operation) ?? 0) + 1)
}
export function takeInteractionWork(id: string): [string, number][] {
  const counts = interactions.get(id)
  interactions.delete(id)
  return [...(counts ?? [])].sort((a, b) => b[1] - a[1]).slice(0, 5)
}
export function clearInteractionWork(): void { interactions.clear() }
