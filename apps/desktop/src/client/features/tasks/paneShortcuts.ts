// Keyboard shortcuts for the task pane switcher. `agents`/`terminal` are toggles (not layout panes);
// the rest dispatch a layout `show`. Each binding is a *chord*: one or more modifiers (⌘/⌃/⌥/⇧)
// plus a base key, so it never fires while typing. A chord is stored as a canonical token —
// modifiers in fixed order then the key, joined by `+` (e.g. `meta+r`, `meta+shift+r`, `ctrl+alt+e`).
// Overridable via the `pane_shortcuts` pref (Settings → Shortcuts); tooltips show the formatted chord.
import type { PaneId } from './layout'

export type PaneAction = PaneId | 'agents' | 'terminal'

export const PANE_SHORTCUT_DEFAULTS: { id: PaneAction; label: string; key: string }[] = [
  { id: 'pr', label: 'PR review', key: 'meta+r' },
  { id: 'changes', label: 'Changes', key: 'meta+g' },
  { id: 'notes', label: 'Notes', key: 'meta+n' },
  { id: 'context', label: 'Context', key: 'meta+x' },
  { id: 'preview', label: 'Browser preview', key: 'meta+b' },
  { id: 'editor', label: 'Editor', key: 'meta+e' },
  { id: 'linear', label: 'Linear', key: 'meta+l' },
  { id: 'rollbar', label: 'Rollbar', key: 'meta+o' },
  { id: 'agents', label: 'Agents', key: 'meta+a' },
  { id: 'terminal', label: 'Terminal', key: 'meta+t' },
]

// Chords the app already owns globally — never assignable to a pane. ⌘K palette, ⌘P file finder,
// ⌘1–9 task rail, ⌘S editor save, ⌘W close pane.
export const RESERVED_CHORDS = new Set([
  'meta+k', 'meta+p', 'meta+s', 'meta+w',
  'meta+1', 'meta+2', 'meta+3', 'meta+4', 'meta+5', 'meta+6', 'meta+7', 'meta+8', 'meta+9',
])

const MODS = ['meta', 'ctrl', 'alt', 'shift'] as const

// The base (non-modifier) key of a keyboard event, normalized: letters/digits by physical code
// (so ⌘⇧R and ⌥3 resolve to `r`/`3` regardless of the shifted glyph), else the single-char key.
// Returns null for lone modifiers, arrows, F-keys, Tab, etc.
function baseKey(e: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3).toLowerCase()
  if (/^Digit[0-9]$/.test(e.code)) return e.code.slice(5)
  const k = e.key.toLowerCase()
  return k.length === 1 ? k : null
}

// Canonical chord token for a keyboard event (modifiers in fixed order + base key), or null if the
// event has no usable base key. Does NOT require a modifier — callers decide (matching only ever
// finds modifier-bearing stored chords; capture rejects the modifier-less case explicitly).
export function eventChord(e: KeyboardEvent): string | null {
  const key = baseKey(e)
  if (!key) return null
  const parts: string[] = []
  if (e.metaKey) parts.push('meta')
  if (e.ctrlKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')
  if (e.shiftKey) parts.push('shift')
  parts.push(key)
  return parts.join('+')
}

function isChord(s: string): boolean {
  const parts = s.split('+')
  const key = parts.pop()
  if (!key || key.length !== 1) return false
  return parts.length > 0 && parts.every((m) => (MODS as readonly string[]).includes(m))
}

// Accept a stored value: a canonical chord as-is, or a legacy bare letter (⌘ was implied) upgraded
// to `meta+<letter>`. Anything else is dropped.
function normalizeStored(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (v.length === 1) return `meta+${v.toLowerCase()}`
  return isChord(v) ? v : null
}

const SYM: Record<string, string> = { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
const DISPLAY_ORDER = ['ctrl', 'alt', 'shift', 'meta'] // macOS convention

// Human label for a chord token: `meta+shift+r` → `⌘⇧R`.
export function formatChord(c: string): string {
  const parts = c.split('+')
  const key = parts.pop() ?? ''
  const mods = DISPLAY_ORDER.filter((m) => parts.includes(m)).map((m) => SYM[m]).join('')
  return mods + key.toUpperCase()
}

// Parse the `pane_shortcuts` pref (JSON Record<PaneAction, chord>) into a validated override map.
function parseOverrides(json: string | undefined): Partial<Record<PaneAction, string>> {
  if (!json) return {}
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    const out: Partial<Record<PaneAction, string>> = {}
    for (const { id } of PANE_SHORTCUT_DEFAULTS) {
      const c = normalizeStored(raw[id])
      if (c) out[id] = c
    }
    return out
  } catch {
    return {}
  }
}

// Effective chord per action (override, else default).
export function paneKeys(prefJson: string | undefined): Record<PaneAction, string> {
  const ov = parseOverrides(prefJson)
  const out = {} as Record<PaneAction, string>
  for (const { id, key } of PANE_SHORTCUT_DEFAULTS) out[id] = ov[id] ?? key
  return out
}

// Reverse map (chord → action) for the keydown handler. First definition wins on a collision.
export function paneKeymap(prefJson: string | undefined): Map<string, PaneAction> {
  const keys = paneKeys(prefJson)
  const map = new Map<string, PaneAction>()
  for (const { id } of PANE_SHORTCUT_DEFAULTS) {
    if (!map.has(keys[id])) map.set(keys[id], id)
  }
  return map
}
