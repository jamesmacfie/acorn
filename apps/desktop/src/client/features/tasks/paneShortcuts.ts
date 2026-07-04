// Keyboard shortcuts for the task pane switcher. `agents`/`terminal` are toggles (not layout panes);
// the rest dispatch a layout `show`. Single mnemonic keys, matching the app's bare-key convention
// (j/k/c). Overridable via the `pane_shortcuts` pref (Settings → Shortcuts); the switcher tooltip
// shows the effective key. Defaults dodge the global bare-key shortcuts (see RESERVED_KEYS).
import type { PaneId } from './layout'

export type PaneAction = PaneId | 'agents' | 'terminal'

export const PANE_SHORTCUT_DEFAULTS: { id: PaneAction; label: string; key: string }[] = [
  { id: 'pr', label: 'PR review', key: 'r' },
  { id: 'changes', label: 'Changes', key: 'g' },
  { id: 'notes', label: 'Notes', key: 'n' },
  { id: 'context', label: 'Context', key: 'x' },
  { id: 'preview', label: 'Browser preview', key: 'b' },
  { id: 'editor', label: 'Editor', key: 'e' },
  { id: 'linear', label: 'Linear', key: 'l' },
  { id: 'rollbar', label: 'Rollbar', key: 'o' },
  { id: 'agents', label: 'Agents', key: 'a' },
  { id: 'terminal', label: 'Terminal', key: 't' },
]

// Keys the global handler (Shortcuts.tsx) + PullList already own — never assignable to a pane.
export const RESERVED_KEYS = new Set(['c', 'j', 'k', '?', '/', '[', ']'])

// Parse the `pane_shortcuts` pref (JSON Record<PaneAction, key>) into a validated override map.
function parseOverrides(json: string | undefined): Partial<Record<PaneAction, string>> {
  if (!json) return {}
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const out: Partial<Record<PaneAction, string>> = {}
    for (const { id } of PANE_SHORTCUT_DEFAULTS) {
      const v = raw[id]
      if (typeof v === 'string' && v.length === 1) out[id] = v.toLowerCase()
    }
    return out
  } catch {
    return {}
  }
}

// Effective key per action (override, else default).
export function paneKeys(prefJson: string | undefined): Record<PaneAction, string> {
  const ov = parseOverrides(prefJson)
  const out = {} as Record<PaneAction, string>
  for (const { id, key } of PANE_SHORTCUT_DEFAULTS) out[id] = ov[id] ?? key
  return out
}

// Reverse map (key → action) for the keydown handler. First definition wins on a collision.
export function paneKeymap(prefJson: string | undefined): Map<string, PaneAction> {
  const keys = paneKeys(prefJson)
  const map = new Map<string, PaneAction>()
  for (const { id } of PANE_SHORTCUT_DEFAULTS) {
    if (!map.has(keys[id])) map.set(keys[id], id)
  }
  return map
}
