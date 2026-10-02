// Literal, case-insensitive matching over the current files, with every term required.
export function searchMemoryFiles<T extends { name: string; description: string; body: string; updatedAt: number }>(memories: T[], query: string): (T & { rank: number })[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  return memories.flatMap((memory) => {
    const name = memory.name.toLowerCase()
    const description = memory.description.toLowerCase()
    const text = `${name} ${description} ${memory.body.toLowerCase()}`
    if (!terms.every((term) => text.includes(term))) return []
    const rank = terms.reduce((score, term) => score + (name.includes(term) ? 3 : description.includes(term) ? 2 : 1), 0)
    return [{ ...memory, rank }]
  }).sort((a, b) => b.rank - a.rank || b.updatedAt - a.updatedAt || a.name.localeCompare(b.name)).slice(0, 10)
}
