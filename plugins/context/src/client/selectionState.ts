// Manifest section selection (docs/agent-tools.md), persisted per task as a scoped state slice
// (context.section-selection). Mirrors editorState.ts: pure signal store + a no-clobber hydrate.
// The store holds only tasks the user has actually touched; the pane falls back to
// selectionFromContext(ctx) for untouched tasks, so a section's defaultIncluded still drives the
// initial view but a curated set is never silently flipped by a later default change.
import { createSignal } from 'solid-js'
import type { TraySelection } from './model'
import { bumpContextRevision, evictContextRevision } from './contextRevision'
import { onScopeEvicted } from '@acorn/plugin-api/client'

const [contextSelections, setContextSelections] = createSignal<Record<string, TraySelection>>({})

export const selectionFor = (taskId: string): TraySelection | undefined => contextSelections()[taskId]

export function setSectionSelection(taskId: string, selection: TraySelection): void {
  setContextSelections((current) => ({ ...current, [taskId]: selection }))
  bumpContextRevision(taskId)
}

export function hydrateContextSelection(taskId: string, value: TraySelection): void {
  setContextSelections((current) => (taskId in current ? current : { ...current, [taskId]: value }))
}

export function evictContextSelection(taskId: string): void {
  setContextSelections((current) => {
    if (!(taskId in current)) return current
    const next = { ...current }
    delete next[taskId]
    return next
  })
  evictContextRevision(taskId)
}

export { contextSelections as contextSelectionsByTask }

// Everything this module holds is keyed by a NODE-MINTED id, so it must not survive a node switch: the
// persistence pass reads these maps and writes each scope under the ACTIVE node's storage key, which
// carried one node's state into another's namespace (client-core's tasks/tasks.ts states the case in full).
export function clearContextSelections(): void {
  setContextSelections({})
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictContextSelection(e.taskId)
  else if (e.scope === 'node-switched') clearContextSelections()
})
