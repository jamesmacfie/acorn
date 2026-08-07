import type { ClientCapabilityRequirement } from '../capabilities'
import type { PaletteItem } from '../palette/model'
import { Registry } from './registry'

export type PaletteRowResult = {
  rows: PaletteItem[]
  // Config parse/cycle errors, reported SEPARATELY rather than as `kind: 'error'` rows inside `rows`.
  // The palette floats every source's errors to the top, because an error explains why a row a user expected
  // is missing — that ordering is a property of the whole list, so no single source can produce it. It is also
  // why a broken .acorn/config.toml stays visible instead of silently yielding no rows (docs 13 §B).
  errors?: { source: string; message: string }[]
}

export type PaletteRowSource = {
  id: string
  // Order among CONTRIBUTED rows, so the list does not depend on plugin declaration order. Core's own rows
  // (actions, workspaces, go-to-task) always follow, as they do today.
  order: number
  requires?: ClientCapabilityRequirement
  // Called when the palette opens, per active task. `null` when there is no active task — a source that has
  // nothing to offer outside a task returns no rows rather than being skipped, so the decision stays its own.
  rows(taskId: string | null): Promise<PaletteRowResult>
  // Run the row this source produced. Returning `{ error }` surfaces a message in the palette; throwing does
  // too (the caller catches), so a source may do either.
  invoke(item: PaletteItem, taskId: string | null): Promise<void | { error?: string }>
}

export const paletteRowRegistry = new Registry<PaletteRowSource>('palette-row-source')

export const paletteRowSources = (): readonly PaletteRowSource[] =>
  paletteRowRegistry.entries().slice().sort((a, b) => a.order - b.order)
