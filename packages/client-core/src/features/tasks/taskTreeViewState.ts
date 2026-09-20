import { createSignal } from 'solid-js'
import { readLocal, writeLocal } from '../../kit/lib/deviceStorage'

const KEY = 'core:task-tree-expanded-roots'

const initial = (): Set<string> => {
  try {
    const value = JSON.parse(readLocal(KEY) ?? '[]') as unknown
    return new Set(Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [])
  } catch { return new Set() }
}

const [expandedWorkflowRoots, setExpandedWorkflowRoots] = createSignal(initial())
export { expandedWorkflowRoots }

export function toggleWorkflowRoot(rootId: string): void {
  setExpandedWorkflowRoots(current => {
    const next = new Set(current)
    if (next.has(rootId)) next.delete(rootId)
    else next.add(rootId)
    writeLocal(KEY, JSON.stringify([...next]))
    return next
  })
}
