/** One task-list row after core lineage has been projected for a host. */
export type TaskHierarchyRow<T> = { task: T; depth: number }
export type WorkflowTaskHierarchyRow<T> = TaskHierarchyRow<T> & {
  workflowDescendants: number
  workflowRootId: string | null
  expanded: boolean
}

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

/**
 * Collapses workflow-created task subtrees under their ordinary root task.
 *
 * This is presentation only: parentId, task order and archive lifecycle remain untouched. When a
 * descendant is active, only its ancestor path is revealed until the reader explicitly expands the
 * root. Other workflow branches remain hidden; ordinary manual siblings keep their normal visibility.
 */
export function workflowTaskHierarchy<T extends { id: string; parentId: string | null; origin: string }>(
  tasks: readonly T[],
  expandedRoots: ReadonlySet<string>,
  activeId: string | null,
): WorkflowTaskHierarchyRow<T>[] {
  const rows = taskHierarchy(tasks)
  const byId = new Map(tasks.map(task => [task.id, task]))
  const children = new Map<string, T[]>()
  for (const task of tasks) if (task.parentId && byId.has(task.parentId)) children.set(task.parentId, [...children.get(task.parentId) ?? [], task])

  const groupByMember = new Map<string, string>()
  const membersByRoot = new Map<string, Set<string>>()
  const addSubtree = (task: T, rootId: string): void => {
    if (groupByMember.has(task.id)) return
    groupByMember.set(task.id, rootId)
    const members = membersByRoot.get(rootId) ?? new Set<string>()
    members.add(task.id)
    membersByRoot.set(rootId, members)
    for (const child of children.get(task.id) ?? []) addSubtree(child, rootId)
  }
  for (const task of tasks) {
    if (task.origin !== 'workflows:child' || !task.parentId) continue
    const parent = byId.get(task.parentId)
    if (!parent || parent.origin === 'workflows:child') continue
    addSubtree(task, parent.id)
  }

  const revealed = new Set<string>()
  let current = activeId ? byId.get(activeId) : undefined
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    revealed.add(current.id)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  return rows.flatMap(row => {
    const workflowRootId = groupByMember.get(row.task.id) ?? (membersByRoot.has(row.task.id) ? row.task.id : null)
    const rootId = groupByMember.get(row.task.id)
    if (rootId && !expandedRoots.has(rootId) && !revealed.has(row.task.id)) return []
    return [{
      ...row,
      workflowDescendants: membersByRoot.get(row.task.id)?.size ?? 0,
      workflowRootId,
      expanded: !!workflowRootId && expandedRoots.has(workflowRootId),
    }]
  })
}
