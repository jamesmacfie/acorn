import type { Component } from 'solid-js'
import type { Task } from '../queries'
import { hasClientCapability, type ClientCapabilityRequirement } from '../capabilities'
import { Registry } from './registry'

export type PaneId = string

export type PaneContribution = {
  id: PaneId
  providerId?: string
  label: string
  glyph: string
  description?: string
  order: number
  defaultChord?: string
  requires?: ClientCapabilityRequirement
  when?: (task: Task) => boolean
  component: Component<{ task: Task }>
  keepAlive?: 'dom' | 'none'
  minWidth?: number
}

// There is no per-pane `freshness` hook here (docs/panes.md § Contributions has the reason).
//
// A pane's own query status is only knowable reactively. TanStack's `getQueryState` is a snapshot, so
// a `freshness(task)` field returning one would render a badge that never updated, which is worse
// than no badge. Making it reactive means either a QueryObserver subscription per pane per render
// inside the host's `<For>`, or each pane publishing a signal it does not currently have.

export const paneRegistry = new Registry<PaneContribution>('pane')

export const paneContributions = (): readonly PaneContribution[] =>
  [...paneRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

export const paneContribution = (id: PaneId): PaneContribution | undefined => paneRegistry.get(id)
export const paneIds = (): PaneId[] => paneContributions().map((pane) => pane.id)
export const paneLabel = (id: PaneId): string => paneContribution(id)?.label ?? id
export const paneAvailable = (pane: PaneContribution, task?: Task): boolean =>
  hasClientCapability(pane.requires) && (!task || !pane.when || pane.when(task))
