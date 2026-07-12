// Manifest section selection (docs/next/context-ui.md), persisted per task as a scoped state slice
// (context.section-selection). Mirrors editorState.ts: pure signal store + a no-clobber hydrate.
// The store holds only tasks the user has actually touched; the pane falls back to
// selectionFromContext(ctx) for untouched tasks, so a section's defaultIncluded still drives the
// initial view but a curated set is never silently flipped by a later default change.
import { createSignal } from 'solid-js'
import type { TraySelection } from './model'

const [contextSelections, setContextSelections] = createSignal<Record<string, TraySelection>>({})

export const selectionFor = (taskId: string): TraySelection | undefined => contextSelections()[taskId]

export function setSectionSelection(taskId: string, selection: TraySelection): void {
  setContextSelections((current) => ({ ...current, [taskId]: selection }))
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
}

export { contextSelections as contextSelectionsByTask }
