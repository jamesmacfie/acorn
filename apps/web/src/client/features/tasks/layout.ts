// Task pane layout (docs/next 03): a flat 2-slot model — 1 or 2 visible panes, a split ratio, one
// optional pinned pane and one optional maximised pane. ONE pure reducer owns every transition
// (both references' split-brain warning: panes/pinned/maximised must move together, never in
// separate calls). The TaskLayout type is the seam for a future recursive tree.
// ponytail: 2 slots, not a LayoutNode tree — side-by-side is the real ergonomics here.

export type PaneId = 'pr' | 'linear' | 'preview' | 'editor' | 'changes' | 'notes' | 'browser'

export type TaskLayout = {
  panes: [PaneId] | [PaneId, PaneId] // left→right
  ratio?: number // 0.2–0.8 split position when 2 panes; default 0.5
  pinned: PaneId | null // fixed pane — switcher clicks target the other slot
  maximised: PaneId | null // one pane filling the area (chrome collapses)
}

export type LayoutAction =
  | { type: 'show'; pane: PaneId } // switcher click
  | { type: 'split'; pane: PaneId } // open pane in the second slot
  | { type: 'close'; pane: PaneId }
  | { type: 'pin'; pane: PaneId }
  | { type: 'unpin' }
  | { type: 'toggleMaximise'; pane: PaneId }
  | { type: 'restore' } // Esc — clear maximise
  | { type: 'setRatio'; ratio: number }
  | { type: 'replace'; layout: TaskLayout } // recipe seeding (docs/next 13 §C) — validated wholesale

export const DEFAULT_PANE: PaneId = 'pr'
export const defaultLayout = (pane: PaneId = DEFAULT_PANE): TaskLayout => ({ panes: [pane], pinned: null, maximised: null })

const PANE_IDS: readonly PaneId[] = ['pr', 'linear', 'preview', 'editor', 'changes', 'notes', 'browser']
export const isPaneId = (v: unknown): v is PaneId => typeof v === 'string' && (PANE_IDS as readonly string[]).includes(v)

const clampRatio = (r: number): number => Math.min(0.8, Math.max(0.2, r))

export function applyLayoutAction(layout: TaskLayout, action: LayoutAction): TaskLayout {
  switch (action.type) {
    case 'show': {
      const { pane } = action
      if (layout.panes.includes(pane)) {
        // Already visible — just drop any maximise so the click has a visible effect.
        return layout.maximised && layout.maximised !== pane ? { ...layout, maximised: null } : layout
      }
      if (layout.pinned && layout.panes.includes(layout.pinned)) {
        // Pinned pane stays put; the clicked pane takes (or creates) the other slot.
        const pinnedIdx = layout.panes.indexOf(layout.pinned)
        const panes: [PaneId, PaneId] = pinnedIdx === 0 ? [layout.pinned, pane] : [pane, layout.pinned]
        return { ...layout, panes, ratio: layout.ratio ?? 0.5, maximised: null }
      }
      // No pin: replace — the right slot when split, the only slot otherwise.
      const panes: TaskLayout['panes'] = layout.panes.length === 2 ? [layout.panes[0], pane] : [pane]
      return { ...layout, panes, maximised: null }
    }
    case 'split': {
      const { pane } = action
      if (layout.panes.includes(pane)) return { ...layout, maximised: null }
      const panes: [PaneId, PaneId] = [layout.panes[0], pane]
      return { ...layout, panes, ratio: layout.ratio ?? 0.5, maximised: null }
    }
    case 'close': {
      const { pane } = action
      if (!layout.panes.includes(pane)) return layout
      const rest = layout.panes.filter((p) => p !== pane)
      const panes: TaskLayout['panes'] = rest.length ? [rest[0]] : [DEFAULT_PANE]
      return {
        ...layout,
        panes,
        pinned: layout.pinned === pane ? null : layout.pinned,
        maximised: layout.maximised === pane ? null : layout.maximised,
      }
    }
    case 'pin':
      // Only a visible pane can be pinned; one pin is meaningful with two slots.
      return layout.panes.includes(action.pane) ? { ...layout, pinned: action.pane } : layout
    case 'unpin':
      return layout.pinned === null ? layout : { ...layout, pinned: null }
    case 'toggleMaximise':
      if (!layout.panes.includes(action.pane)) return layout
      return { ...layout, maximised: layout.maximised === action.pane ? null : action.pane }
    case 'restore':
      return layout.maximised === null ? layout : { ...layout, maximised: null }
    case 'setRatio':
      if (layout.panes.length !== 2) return layout
      return { ...layout, ratio: clampRatio(action.ratio) }
    case 'replace':
      return normalizeLayout(action.layout) ?? layout
  }
}

// Validate a persisted value back into a TaskLayout (defensive: prefs survive schema evolution).
export function normalizeLayout(v: unknown): TaskLayout | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Partial<TaskLayout>
  if (!Array.isArray(o.panes) || o.panes.length < 1 || o.panes.length > 2) return null
  if (!o.panes.every(isPaneId)) return null
  const panes = (o.panes.length === 2 && o.panes[0] !== o.panes[1] ? [o.panes[0], o.panes[1]] : [o.panes[0]]) as TaskLayout['panes']
  return {
    panes,
    ratio: typeof o.ratio === 'number' ? clampRatio(o.ratio) : undefined,
    pinned: isPaneId(o.pinned) && panes.includes(o.pinned) ? o.pinned : null,
    maximised: isPaneId(o.maximised) && panes.includes(o.maximised) ? o.maximised : null,
  }
}

// Migration: the old `task_panes` pref (Record<taskId, PaneId>) → per-task layouts.
export function migrateTaskPanes(old: unknown): Record<string, TaskLayout> {
  const out: Record<string, TaskLayout> = {}
  if (!old || typeof old !== 'object') return out
  for (const [taskId, pane] of Object.entries(old as Record<string, unknown>)) {
    if (isPaneId(pane)) out[taskId] = defaultLayout(pane)
  }
  return out
}

// Hydrate the persisted `task_layouts` pref (with `task_panes` as the legacy fallback).
export function parseTaskLayouts(layoutsJson: string | undefined, legacyPanesJson: string | undefined): Record<string, TaskLayout> {
  if (layoutsJson) {
    try {
      const raw = JSON.parse(layoutsJson) as Record<string, unknown>
      const out: Record<string, TaskLayout> = {}
      for (const [taskId, v] of Object.entries(raw)) {
        const layout = normalizeLayout(v)
        if (layout) out[taskId] = layout
      }
      return out
    } catch {
      // fall through to legacy
    }
  }
  try {
    return migrateTaskPanes(legacyPanesJson ? JSON.parse(legacyPanesJson) : {})
  } catch {
    return {}
  }
}
