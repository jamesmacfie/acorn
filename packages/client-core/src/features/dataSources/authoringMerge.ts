export type AuthoringMergeConflict = { path: string; base: unknown; proposal: unknown; current: unknown }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const key = (value: unknown): string | undefined => object(value)
  ? typeof value.id === 'string' ? value.id : typeof value.name === 'string' ? value.name : undefined
  : undefined

/** Rebase an AI candidate over a newer draft. Identified arrays align by stable id/name. */
export function mergeAuthoringCandidate<T>(base: T, proposal: T, current: T): { value: T; conflicts: AuthoringMergeConflict[] } {
  const conflicts: AuthoringMergeConflict[] = []
  const merge = (baseValue: unknown, proposedValue: unknown, currentValue: unknown, path: string): unknown => {
    if (equal(proposedValue, currentValue) || equal(baseValue, currentValue)) return proposedValue
    if (equal(baseValue, proposedValue)) return currentValue
    if (object(baseValue) && object(proposedValue) && object(currentValue)) {
      return Object.fromEntries([...new Set([...Object.keys(baseValue), ...Object.keys(proposedValue), ...Object.keys(currentValue)])]
        .map(name => [name, merge(baseValue[name], proposedValue[name], currentValue[name], `${path}/${name}`)])
        .filter(([, value]) => value !== undefined))
    }
    if (Array.isArray(baseValue) && Array.isArray(proposedValue) && Array.isArray(currentValue)) {
      const baseKeys = baseValue.map(key)
      const proposalKeys = proposedValue.map(key)
      const currentKeys = currentValue.map(key)
      if (baseKeys.every(Boolean) && proposalKeys.every(Boolean) && currentKeys.every(Boolean)
        && new Set(baseKeys).size === baseKeys.length && new Set(proposalKeys).size === proposalKeys.length && new Set(currentKeys).size === currentKeys.length) {
        const by = (items: unknown[]) => new Map(items.map(item => [key(item)!, item]))
        const left = by(baseValue); const proposed = by(proposedValue); const now = by(currentValue)
        return [...new Set([...currentKeys, ...proposalKeys, ...baseKeys])].map(id =>
          merge(left.get(id!), proposed.get(id!), now.get(id!), `${path}/@${id}`)).filter(value => value !== undefined)
      }
    }
    conflicts.push({ path: path || '/', base: baseValue, proposal: proposedValue, current: currentValue })
    return currentValue
  }
  return { value: merge(base, proposal, current, '') as T, conflicts }
}
