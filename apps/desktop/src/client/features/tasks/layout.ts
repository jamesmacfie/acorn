// Task pane layout: a left→right row of open panes. A switcher click shows a single pane; a
// ⌘/ctrl-click opens a pane to the right of the ones already open. Close a pane (only shown when
// more than one is open) to drop it. ONE pure reducer owns every transition.
// ponytail: a flat panes[] row, not a LayoutNode tree — open-what-you-want side by side is enough.

// NOTE: there is no separate 'browser' pane — agent-driving is a capability of `preview` (the
// shared per-task <webview> is bound for CDP once it reaches dom-ready). Config recipes that still
// name unknown pane ids are tolerated: isPaneId filters them out wherever layouts are parsed.
export type PaneId = 'pr' | 'linear' | 'rollbar' | 'preview' | 'editor' | 'changes' | 'notes' | 'context' | 'database'

export type TaskLayout = {
  panes: PaneId[] // left→right, at least one; no duplicates
}

export type LayoutAction =
  | { type: 'show'; pane: PaneId } // switcher click — show just this pane
  | { type: 'add'; pane: PaneId } // ⌘/ctrl-click — open to the right of the open panes
  | { type: 'close'; pane: PaneId }
  | { type: 'replace'; layout: TaskLayout } // recipe seeding — validated wholesale

// Human labels for each pane, used by the switcher tooltips and the command palette (docs/command-palette-and-shortcuts.md).
export const PANE_LABELS: Record<PaneId, string> = {
  pr: 'PR review',
  linear: 'Linear',
  rollbar: 'Rollbar',
  preview: 'Browser preview',
  editor: 'Editor',
  changes: 'Changes',
  notes: 'Notes',
  context: 'Context',
  database: 'Database',
}

// Canonical pane ordering for pane pickers (e.g. the palette's "Show pane" rows): task-context
// panes first, then providers. Lives next to PANE_LABELS so order and labels stay in one place.
export const PANE_ORDER: readonly PaneId[] = ['pr', 'changes', 'notes', 'context', 'editor', 'database', 'preview', 'linear', 'rollbar']

export const DEFAULT_PANE: PaneId = 'pr'
export const defaultLayout = (pane: PaneId = DEFAULT_PANE): TaskLayout => ({ panes: [pane] })

const PANE_IDS: readonly PaneId[] = ['pr', 'linear', 'rollbar', 'preview', 'editor', 'changes', 'notes', 'context', 'database']
export const isPaneId = (v: unknown): v is PaneId => typeof v === 'string' && (PANE_IDS as readonly string[]).includes(v)

export function applyLayoutAction(layout: TaskLayout, action: LayoutAction): TaskLayout {
  switch (action.type) {
    case 'show': {
      const { pane } = action
      // Already the only open pane → nothing to do.
      if (layout.panes.length === 1 && layout.panes[0] === pane) return layout
      return { panes: [pane] }
    }
    case 'add': {
      const { pane } = action
      if (layout.panes.includes(pane)) return layout
      return { panes: [...layout.panes, pane] }
    }
    case 'close': {
      const { pane } = action
      if (!layout.panes.includes(pane)) return layout
      const rest = layout.panes.filter((p) => p !== pane)
      return { panes: rest.length ? rest : [DEFAULT_PANE] }
    }
    case 'replace':
      return normalizeLayout(action.layout) ?? layout
  }
}

// Validate a persisted value back into a TaskLayout (defensive: prefs survive schema evolution).
// Tolerates earlier shapes: the legacy `{ panes, pinned, ratio }` slot model and the short-lived
// `{ active, pinned[] }` pin model both collapse into the flat `panes[]` row.
export function normalizeLayout(v: unknown): TaskLayout | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  let raw: unknown[]
  if (Array.isArray(o.panes)) raw = o.panes
  else if (isPaneId(o.active)) raw = [o.active, ...(Array.isArray(o.pinned) ? o.pinned : [])]
  else return null
  const panes = [...new Set(raw.filter(isPaneId))]
  if (!panes.length) return null
  return { panes }
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
