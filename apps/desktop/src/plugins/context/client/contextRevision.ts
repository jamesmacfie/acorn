import { createSignal } from 'solid-js'

const [revisions, setRevisions] = createSignal<Record<string, number>>({})

export const contextRevisionFor = (taskId: string): number => revisions()[taskId] ?? 0

export function bumpContextRevision(taskId: string): void {
  setRevisions((current) => ({ ...current, [taskId]: (current[taskId] ?? 0) + 1 }))
}

export function evictContextRevision(taskId: string): void {
  setRevisions((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
}
