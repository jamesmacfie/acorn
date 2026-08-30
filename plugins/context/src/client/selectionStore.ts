// Manifest section selection (docs/agent-tools.md), persisted per task as a scoped state slice
// (context.section-selection). Mirrors editorState.ts: pure signal store + a no-clobber hydrate, plus the persisted-state descriptor.
// The store holds only tasks the user has actually touched; the pane falls back to
// selectionFromContext(ctx) for untouched tasks, so a section's defaultIncluded still drives the
// initial view but a curated set is never silently flipped by a later default change.
import { createSignal } from 'solid-js'
import { parseJson, PersistedSliceKeys, type PersistedStateSlice } from '@acorn/plugin-api/client'
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

// Everything this module holds is keyed by a node-minted id, so it must not survive a node switch.
// The persistence pass reads these maps and writes each scope under the active node's storage key,
// which carried one node's state into another's namespace (client-core's tasks/tasks.ts states the
// case in full).
export function clearContextSelections(): void {
  setContextSelections({})
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'task') evictContextSelection(e.taskId)
  else if (e.scope === 'node-switched') clearContextSelections()
})

// The context tray's own persisted-state descriptor: which sections are selected, per task. Owned
// here rather than in core so core never has to know which features persist state (docs/plugins.md);
// registered by this plugin's own ClientPlugin init (client/index.ts).
const parseContextSelection = (raw: unknown): TraySelection => {
  const value = parseJson(raw)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => typeof v === 'boolean')) as TraySelection
}

export const contextSelectionSlice: PersistedStateSlice<TraySelection> = {
  id: 'context.section-selection',
  key: PersistedSliceKeys.contextSelection,
  scope: 'task',
  restore: 'panes',
  version: 1,
  codec: { parse: parseContextSelection, serialize: (value) => value },
  empty: () => ({}),
  unknownIds: 'retain-inert',
  maxBytes: 4 * 1024,
  binding: { values: contextSelections, hydrate: hydrateContextSelection },
}
