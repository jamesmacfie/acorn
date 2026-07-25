import { parseJson, type PersistedStateSlice } from '../../../core/client/persistence/persistedState'
import { PersistedSliceKeys } from '../../../core/client/persistence/prefKeys'
import type { TraySelection } from './model'
import { contextSelectionsByTask, hydrateContextSelection } from './selectionState'

// The context tray's own persisted-state descriptor: which sections are selected, per task. Owned
// here rather than in core so core never has to know which features persist state (docs/plugins.md);
// registered by the composition root in app/client/persistedSliceContributions.ts.
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
  binding: { values: contextSelectionsByTask, hydrate: hydrateContextSelection },
}
