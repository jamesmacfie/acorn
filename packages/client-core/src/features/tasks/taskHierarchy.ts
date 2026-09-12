/** One task-list row after core lineage has been projected for a host. */
export type TaskHierarchyRow<T> = { task: T; depth: number }

/**
 * Group descendants after their parent while retaining the caller's order among roots and siblings.
 *
 * Missing parents and every member of a cycle stay as depth-zero roots. Descendants of those rows
 * can still nest normally. This makes corrupt or partially-restored lineage visible and selectable
 * instead of dropping it or recursing forever.
 */
export function taskHierarchy<T extends { id: string; parentId: string | null }>(tasks: readonly T[]): TaskHierarchyRow<T>[] {
  const byId = new Map(tasks.map((task) => [task.id, task]))
  const cycleIds = new Set<string>()

  for (const task of tasks) {
    const path: string[] = []
    const positions = new Map<string, number>()
    let current: T | undefined = task
    while (current) {
      const seenAt = positions.get(current.id)
      if (seenAt !== undefined) {
        for (const id of path.slice(seenAt)) cycleIds.add(id)
        break
      }
      positions.set(current.id, path.length)
      path.push(current.id)
      current = current.parentId ? byId.get(current.parentId) : undefined
    }
  }

  const parentFor = (task: T): T | undefined => {
    if (!task.parentId || cycleIds.has(task.id)) return undefined
    return byId.get(task.parentId)
  }
  const children = new Map<string, T[]>()
  const roots: T[] = []
  for (const task of tasks) {
    const parent = parentFor(task)
    if (!parent) roots.push(task)
    else children.set(parent.id, [...children.get(parent.id) ?? [], task])
  }

  const rows: TaskHierarchyRow<T>[] = []
  const append = (task: T, depth: number): void => {
    rows.push({ task, depth })
    for (const child of children.get(task.id) ?? []) append(child, depth + 1)
  }
  for (const task of roots) append(task, 0)
  return rows
}
