// Persisted task-pane layout. The row stays deliberately flat: pane order, id-keyed relative
// weights, and pins are durable; focused/maximized state is session-owned in tasks.ts. Pane ids are
// strings so descriptors can be added without widening a core union and unknown persisted ids can
// survive a version that does not currently register them.
import type { PaneId } from '../registries/panes'

export type { PaneId } from '../registries/panes'

export type TaskLayout = {
  panes: PaneId[]
  weights?: Partial<Record<PaneId, number>>
  pinned?: PaneId[]
}

export type LayoutAction =
  | { type: 'show'; pane: PaneId }
  | { type: 'add'; pane: PaneId }
  | { type: 'close'; pane: PaneId }
  | { type: 'pin'; pane: PaneId; pinned?: boolean }
  | { type: 'move'; pane: PaneId; direction: -1 | 1 }
  | {
      type: 'resize'
      pane: PaneId
      adjacent: PaneId
      deltaPx: number
      paneWidth: number
      adjacentWidth: number
      paneMinWidth?: number
      adjacentMinWidth?: number
    }
  | { type: 'equalize' }
  | { type: 'replace'; layout: TaskLayout }

export const DEFAULT_PANE: PaneId = 'pr'
export const defaultLayout = (pane: PaneId = DEFAULT_PANE): TaskLayout => ({ panes: [pane] })

// Persistence validation intentionally answers "is this a pane-shaped id?", not "is it registered
// in this build?". Render hosts perform the registry lookup and leave unknown ids inert.
export const isPaneId = (value: unknown): value is PaneId => typeof value === 'string' && value.trim().length > 0

const sameIds = (a: readonly string[] | undefined, b: readonly string[] | undefined): boolean =>
  (a?.length ?? 0) === (b?.length ?? 0) && (a ?? []).every((id, index) => id === b?.[index])

export function applyLayoutAction(layout: TaskLayout, action: LayoutAction): TaskLayout {
  switch (action.type) {
    case 'show': {
      const pinned = new Set(layout.pinned ?? [])
      const panes = layout.panes.filter((id) => pinned.has(id))
      if (!panes.includes(action.pane)) panes.push(action.pane)
      if (sameIds(panes, layout.panes)) return layout
      return { ...layout, panes }
    }
    case 'add':
      return layout.panes.includes(action.pane) ? layout : { ...layout, panes: [...layout.panes, action.pane] }
    case 'close': {
      if (!layout.panes.includes(action.pane)) return layout
      const pinned = layout.pinned ?? []
      // Pinned-browser-tab convention: the first close gesture only removes the guard.
      if (pinned.includes(action.pane)) return { ...layout, pinned: pinned.filter((id) => id !== action.pane) }
      const panes = layout.panes.filter((id) => id !== action.pane)
      return { ...layout, panes: panes.length ? panes : [DEFAULT_PANE] }
    }
    case 'pin': {
      if (!layout.panes.includes(action.pane)) return layout
      const pinned = layout.pinned ?? []
      const shouldPin = action.pinned ?? !pinned.includes(action.pane)
      if (shouldPin === pinned.includes(action.pane)) return layout
      const next = shouldPin ? [...pinned, action.pane] : pinned.filter((id) => id !== action.pane)
      return { ...layout, pinned: next }
    }
    case 'move': {
      const from = layout.panes.indexOf(action.pane)
      const to = from + action.direction
      if (from < 0 || to < 0 || to >= layout.panes.length) return layout
      const panes = [...layout.panes]
      ;[panes[from], panes[to]] = [panes[to], panes[from]]
      return { ...layout, panes }
    }
    case 'resize': {
      if (!layout.panes.includes(action.pane) || !layout.panes.includes(action.adjacent)) return layout
      const total = action.paneWidth + action.adjacentWidth
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(action.deltaPx)) return layout
      const paneMin = Math.max(0, action.paneMinWidth ?? 240)
      const adjacentMin = Math.max(0, action.adjacentMinWidth ?? 240)
      const lower = Math.min(paneMin, Math.max(0, total - adjacentMin))
      const upper = Math.max(lower, total - adjacentMin)
      const paneWeight = Math.min(Math.max(action.paneWidth + action.deltaPx, lower), upper)
      const adjacentWeight = total - paneWeight
      return {
        ...layout,
        weights: { ...layout.weights, [action.pane]: paneWeight, [action.adjacent]: adjacentWeight },
      }
    }
    case 'equalize': {
      const weights = { ...layout.weights }
      for (const pane of layout.panes) weights[pane] = 1
      return { ...layout, weights }
    }
    case 'replace':
      return normalizeLayout(action.layout) ?? layout
  }
}

export function normalizeLayout(value: unknown): TaskLayout | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const legacyActive = isPaneId(raw.active) ? raw.active : null
  const rawPanes = Array.isArray(raw.panes)
    ? raw.panes
    : legacyActive
      ? [legacyActive, ...(Array.isArray(raw.pinned) ? raw.pinned : [])]
      : null
  if (!rawPanes) return null
  const panes = [...new Set(rawPanes.filter(isPaneId))]
  if (!panes.length) return null

  const pinned = Array.isArray(raw.pinned) ? [...new Set(raw.pinned.filter(isPaneId))] : []
  const weights: Partial<Record<PaneId, number>> = {}
  if (raw.weights && typeof raw.weights === 'object' && !Array.isArray(raw.weights)) {
    for (const [id, weight] of Object.entries(raw.weights as Record<string, unknown>)) {
      if (isPaneId(id) && typeof weight === 'number' && Number.isFinite(weight) && weight > 0) weights[id] = weight
    }
  }
  return {
    panes,
    ...(Object.keys(weights).length ? { weights } : {}),
    ...(pinned.length ? { pinned } : {}),
  }
}

export function migrateTaskPanes(old: unknown): Record<string, TaskLayout> {
  const out: Record<string, TaskLayout> = {}
  if (!old || typeof old !== 'object') return out
  for (const [taskId, pane] of Object.entries(old as Record<string, unknown>)) {
    if (isPaneId(pane)) out[taskId] = defaultLayout(pane)
  }
  return out
}

export function parseTaskLayouts(layoutsJson: string | undefined, legacyPanesJson: string | undefined): Record<string, TaskLayout> {
  if (layoutsJson) {
    try {
      const raw = JSON.parse(layoutsJson) as Record<string, unknown>
      const out: Record<string, TaskLayout> = {}
      for (const [taskId, value] of Object.entries(raw)) {
        const layout = normalizeLayout(value)
        if (layout) out[taskId] = layout
      }
      return out
    } catch {
      // Fall through to the legacy single-pane preference.
    }
  }
  try {
    return migrateTaskPanes(legacyPanesJson ? JSON.parse(legacyPanesJson) : {})
  } catch {
    return {}
  }
}
