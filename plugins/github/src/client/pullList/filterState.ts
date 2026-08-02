// GitHub PR list filter state, kept per workspace (docs/workspaces-and-tasks.md). The open/closed tab and the
// free-text query are remembered per workspace id and persisted to the `pr_filters` pref (App.tsx),
// so returning to a workspace restores its last filter. Signals-only, like ../tasks/tasks.ts.
import { createSignal } from 'solid-js'

export type PrFilter = { tab: 'open' | 'closed'; filter: string }
const defaultFilter = (): PrFilter => ({ tab: 'open', filter: '' })

const [prFilters, setPrFilters] = createSignal<Record<string, PrFilter>>({})

export const prFilterFor = (workspaceId: string): PrFilter => prFilters()[workspaceId] ?? defaultFilter()

export function setPrFilter(workspaceId: string, patch: Partial<PrFilter>): void {
  setPrFilters((prev) => ({ ...prev, [workspaceId]: { ...(prev[workspaceId] ?? defaultFilter()), ...patch } }))
}

// Seed from the persisted `pr_filters` pref at startup without clobbering anything changed pre-hydration.
export function hydratePrFilters(json: string | undefined): void {
  if (!json) return
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const out: Record<string, PrFilter> = {}
    for (const [id, v] of Object.entries(raw)) {
      if (!v || typeof v !== 'object') continue
      const o = v as Record<string, unknown>
      out[id] = { tab: o.tab === 'closed' ? 'closed' : 'open', filter: typeof o.filter === 'string' ? o.filter : '' }
    }
    setPrFilters((p) => ({ ...out, ...p }))
  } catch {
    /* ignore malformed pref */
  }
}

export function hydratePrFilter(workspaceId: string, filter: PrFilter): void {
  setPrFilters((current) => (current[workspaceId] ? current : { ...current, [workspaceId]: filter }))
}

export function evictPrFilter(workspaceId: string): void {
  setPrFilters((current) => {
    if (!(workspaceId in current)) return current
    const next = { ...current }
    delete next[workspaceId]
    return next
  })
}

export { prFilters }
