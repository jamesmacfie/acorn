// GitHub PR list filter state, kept per workspace (docs/workspaces-and-tasks.md). The open/closed tab and the
// free-text query are remembered per workspace id and persisted to the `pr_filters` pref (App.tsx),
// so returning to a workspace restores its last filter. Signals-only, like ../tasks/tasks.ts.
import { createSignal } from 'solid-js'
import { onScopeEvicted } from '@acorn/client-core/registries/scopeEviction.ts'

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

// Everything this module holds is keyed by a NODE-MINTED id, so it must not survive a node switch: the
// persistence pass reads these maps and writes each scope under the ACTIVE node's storage key, which
// carried one node's state into another's namespace (client-core's tasks/tasks.ts states the case in full).
export function clearPrFilters(): void {
  setPrFilters({})
}

// Registered here rather than listed in the shell's evictor file, so this signal and the thing that
// clears it are one edit apart (registries/scopeEviction.ts states the full argument).
onScopeEvicted((e) => {
  if (e.scope === 'workspace') evictPrFilter(e.workspaceId)
  else if (e.scope === 'node-switched') clearPrFilters()
})
