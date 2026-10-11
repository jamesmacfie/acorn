import { createSignal } from 'solid-js'
import { onScopeEvicted, parseJson, type PersistedStateSlice } from '@acorn/plugin-api/client'

type SessionExpansion = Record<string, boolean>
const [expansionByTask, setExpansionByTask] = createSignal<Record<string, SessionExpansion>>({})

export const composerExpanded = (taskId: string, sessionId: string): boolean =>
  expansionByTask()[taskId]?.[sessionId] ?? false

export function toggleComposerExpanded(taskId: string, sessionId: string): void {
  setExpansionByTask((current) => ({
    ...current,
    [taskId]: { ...current[taskId], [sessionId]: !current[taskId]?.[sessionId] },
  }))
}

export function clearComposerExpansion(sessionId: string): void {
  setExpansionByTask((current) =>
    Object.fromEntries(
      Object.entries(current).map(([taskId, sessions]) => {
        if (!(sessionId in sessions)) return [taskId, sessions]
        const next = { ...sessions }
        delete next[sessionId]
        return [taskId, next]
      }),
    ),
  )
}

onScopeEvicted((event) => {
  if (event.scope === 'node-switched') setExpansionByTask({})
  else if (event.scope === 'task') {
    setExpansionByTask((current) => {
      const next = { ...current }
      delete next[event.taskId]
      return next
    })
  }
})

// Task-scoped slices qualify storage by Node and restore on navigation back to that Node.
// Keep explicit false values so a collapse made before restoration wins over a saved expansion.
export const composerExpansionSlice: PersistedStateSlice<SessionExpansion> = {
  id: 'agents.composer-expansion',
  key: 'agents:composer-expansion',
  scope: 'task',
  restore: 'panes',
  version: 1,
  codec: {
    parse: (raw) => {
      const value = parseJson(raw)
      if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
      return Object.fromEntries(Object.entries(value).filter(([, expanded]) => typeof expanded === 'boolean'))
    },
    serialize: (value) => value,
  },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes: 64 * 1024,
  binding: {
    values: expansionByTask,
    hydrate: (taskId, value) =>
      setExpansionByTask((current) => ({
        ...current,
        [taskId]: { ...value, ...current[taskId] },
      })),
  },
}
