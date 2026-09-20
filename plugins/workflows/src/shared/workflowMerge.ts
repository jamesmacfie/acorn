export type WorkflowMergeConflict = { path: string; base: unknown; local: unknown; external: unknown }
export type WorkflowMergeResult<T> = { value: T; conflicts: WorkflowMergeConflict[] }
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const identified = (value: unknown[]): value is (Record<string, unknown> & { id: string })[] =>
  value.every(item => object(item) && typeof item.id === 'string') && new Set(value.map(item => (item as { id: string }).id)).size === value.length

/** Stable IDs align lists. Conflicts keep local values until the caller makes an explicit choice. */
export function mergeWorkflow<T>(base: T, local: T, external: T, choices: Record<string, 'local' | 'external'> = {}): WorkflowMergeResult<T> {
  const conflicts: WorkflowMergeConflict[] = []
  const conflict = (path: string, base: unknown, local: unknown, external: unknown) => {
    if (choices[path]) return choices[path] === 'external' ? external : local
    conflicts.push({ path, base, local, external })
    return local
  }
  const merge = (base: unknown, local: unknown, external: unknown, path: string): unknown => {
    if (equal(local, external) || equal(base, external)) return local
    if (equal(base, local)) return external
    if (object(base) && object(local) && object(external)) {
      return Object.fromEntries([...new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(external)])]
        .map(key => [key, merge(base[key], local[key], external[key], `${path}/${key}`)])
        .filter(([, value]) => value !== undefined))
    }
    if (Array.isArray(base) && Array.isArray(local) && Array.isArray(external) && identified(base) && identified(local) && identified(external)) {
      const ids = (items: { id: string }[]) => items.map(item => item.id)
      const common = new Set(ids(base).filter(id => local.some(item => item.id === id) && external.some(item => item.id === id)))
      const order = (items: { id: string }[]) => ids(items).filter(id => common.has(id))
      const localReordered = !equal(order(base), order(local))
      const externalReordered = !equal(order(base), order(external))
      if (localReordered && externalReordered && !equal(order(local), order(external))) return conflict(path, base, local, external)
      const localStructure = !equal(ids(base), ids(local))
      const externalStructure = !equal(ids(base), ids(external))
      if (localStructure && externalStructure && !equal(ids(local), ids(external))) return conflict(path, base, local, external)
      // Deletion versus edit keeps the original slot until the deletion is explicitly accepted.
      const deletedAndEdited = base.some(item => {
        const mine = local.find(next => next.id === item.id)
        const theirs = external.find(next => next.id === item.id)
        return (!mine && theirs && !equal(item, theirs)) || (!theirs && mine && !equal(item, mine))
      })
      const first = deletedAndEdited ? base : externalStructure ? external : local
      const second = externalStructure ? local : external
      return [...new Set([...ids(first), ...ids(second), ...ids(base)])].map(id =>
        merge(base.find(item => item.id === id), local.find(item => item.id === id), external.find(item => item.id === id), `${path}/@${id}`)).filter(item => item !== undefined)
    }
    return conflict(path || '/', base, local, external)
  }
  return { value: merge(base, local, external, '') as T, conflicts }
}
