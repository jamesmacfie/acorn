import { createSignal, For, Show } from 'solid-js'
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../queries'
import { SHORTCUTS } from '../../Shortcuts'
import { eventChord, formatChord, PANE_SHORTCUT_DEFAULTS, paneKeys, RESERVED_CHORDS, type PaneAction } from '../tasks/paneShortcuts'
import { savePref } from './savePref'

// Settings → Shortcuts: editable pane chords plus the read-only global + terminal lists. Editing
// captures the next key press on the focused row's input, rejects reserved keys and collisions,
// then persists a `pane_shortcuts` override diff (JSON Record<action, chord>).

// Shortcuts owned by the terminal drawer (handlers live in features/terminal). ⌘ chords pass
// through a focused terminal to the app; Ctrl/Alt chords are terminal input (Ctrl+C etc.).
const TERMINAL_SHORTCUTS: Array<[string, string]> = [
  ['⌘⇧1 – ⌘⇧9', 'Focus terminal tab 1–9 (drawer open)'],
  ['⌘W', 'Close the active terminal tab (focus in the drawer)'],
  ['⇧↩', 'Insert a newline instead of submitting (agent prompts)'],
]
export default function ShortcutsSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const [shortcutErr, setShortcutErr] = createSignal('')
  const readOverrides = (): Record<string, string> => {
    try {
      return prefs.data?.pane_shortcuts ? (JSON.parse(prefs.data.pane_shortcuts) as Record<string, string>) : {}
    } catch {
      return {}
    }
  }
  const captureKey = (id: PaneAction, e: KeyboardEvent) => {
    e.preventDefault()
    const input = e.currentTarget as HTMLElement
    if (e.key === 'Escape' || e.key === 'Tab') return input.blur()
    const c = eventChord(e)
    if (!c) return // lone modifier / unsupported key — keep waiting for the full chord
    if (!(e.metaKey || e.ctrlKey || e.altKey)) return setShortcutErr('Add a modifier — ⌘, ⌃ or ⌥')
    if (RESERVED_CHORDS.has(c)) return setShortcutErr(`${formatChord(c)} is reserved by a global shortcut`)
    const keys = paneKeys(prefs.data?.pane_shortcuts)
    const clash = (Object.keys(keys) as PaneAction[]).find((a) => a !== id && keys[a] === c)
    if (clash) return setShortcutErr(`${formatChord(c)} is already used by ${PANE_SHORTCUT_DEFAULTS.find((s) => s.id === clash)?.label}`)
    setShortcutErr('')
    void savePref(qc, 'pane_shortcuts', JSON.stringify({ ...readOverrides(), [id]: c }))
    input.blur()
  }

  return (
    <>
      <div class="settings-section-label">Panes</div>
      <p class="muted">Click a key, then press the chord you want (hold ⌘/⌃/⌥, e.g. ⌘⇧R). Active in the task view.</p>
      <Show when={shortcutErr()}><div class="action-error">{shortcutErr()}</div></Show>
      <dl class="help-list">
        <For each={PANE_SHORTCUT_DEFAULTS}>
          {(s) => (
            <>
              <dt>
                <input
                  type="text"
                  class="help-key shortcut-input"
                  readonly
                  value={formatChord(paneKeys(prefs.data?.pane_shortcuts)[s.id])}
                  onKeyDown={(e) => captureKey(s.id, e)}
                  aria-label={`Shortcut for ${s.label}`}
                />
              </dt>
              <dd class="help-desc">{s.label}</dd>
            </>
          )}
        </For>
      </dl>
      <div class="settings-actions">
        <button type="button" class="overlay-btn" onClick={() => { setShortcutErr(''); void savePref(qc, 'pane_shortcuts', '{}') }}>
          Reset panes to defaults
        </button>
      </div>
      <div class="settings-section-label">Global</div>
      <dl class="help-list">
        <For each={SHORTCUTS}>
          {([key, desc]) => (
            <>
              <dt class="help-key">{key}</dt>
              <dd class="help-desc">{desc}</dd>
            </>
          )}
        </For>
      </dl>
      <div class="settings-section-label">Terminal</div>
      <p class="muted">⌘ shortcuts (panes, palette, global) still work while the terminal is focused; ⌃/⌥ keys go to the shell.</p>
      <dl class="help-list">
        <For each={TERMINAL_SHORTCUTS}>
          {([key, desc]) => (
            <>
              <dt class="help-key">{key}</dt>
              <dd class="help-desc">{desc}</dd>
            </>
          )}
        </For>
      </dl>
    </>
  )
}
