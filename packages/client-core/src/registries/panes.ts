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

// There is deliberately NO per-pane `freshness` hook here, and it is worth saying why, because docs/architecture-overview.md's
// "offline/stale rendering everywhere" reads like it wants one.
//
// A pane's own query status is only knowable reactively — TanStack's `getQueryState` is a snapshot, so a
// `freshness(task)` field returning one would render a badge that never updated, which is worse than no
// badge. Making it reactive means either a QueryObserver subscription per pane per render inside the host's
// `<For>`, or each pane publishing a signal it does not currently have.
//
// What the host renders instead is the NODE's state, which is the half docs/ui-design.md's vocabulary is actually
// about (`offline`/`stale`/`error` all come from the connection) and which IS reactive. A pane that wants
// to say more about its own data renders it in its own header, where it has the query in scope.

export const paneRegistry = new Registry<PaneContribution>('pane')

export const paneContributions = (): readonly PaneContribution[] =>
  [...paneRegistry.entries()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))

export const paneContribution = (id: PaneId): PaneContribution | undefined => paneRegistry.get(id)
export const paneIds = (): PaneId[] => paneContributions().map((pane) => pane.id)
export const paneLabel = (id: PaneId): string => paneContribution(id)?.label ?? id
export const paneAvailable = (pane: PaneContribution, task?: Task): boolean =>
  hasClientCapability(pane.requires) && (!task || !pane.when || pane.when(task))
