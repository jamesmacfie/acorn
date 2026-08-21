import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { PrefKeys, prefsOptions, savePref, termFontSize } from '@acorn/plugin-api/client'
import { resolveTerminalFontSize, TERMINAL_FONT_SIZE_OPTIONS } from './preferences'
import { Checkbox, Select } from '@acorn/plugin-api/ui'

// Settings → Terminal: the rail-default profile, what the terminal button auto-launches when the
// drawer opens empty (TerminalPanel reads `term_rail_default`).
export default function TerminalSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const railDefault = () => prefs.data?.[PrefKeys.terminalRailDefault] ?? 'empty'
  const fontSize = () => resolveTerminalFontSize(prefs.data?.[PrefKeys.terminalFontSize], termFontSize())
  // Opt-out: absent pref means on (matches contextInjectionEnabled in core/main/taskWorktree.ts).
  const injectContext = () => (prefs.data?.[PrefKeys.startupContextInjection] ?? 'true') !== 'false'

  return (
    <>
      <label class="settings-field">
        <span class="settings-label">When the terminal button is clicked, open</span>
        <Select
          value={railDefault()}
          onChange={(e) => void savePref(qc, PrefKeys.terminalRailDefault, e.currentTarget.value)}
        >
          <option value="empty">Empty (pick a profile with +)</option>
          <option value="shell">Shell</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
        </Select>
      </label>
      <label class="settings-field">
        <span class="settings-label">Terminal text size</span>
        <Select
          value={String(fontSize())}
          onChange={(e) => void savePref(qc, PrefKeys.terminalFontSize, e.currentTarget.value)}
        >
          {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
            <option value={String(size)}>{size}px{size === 15 ? ' (default)' : ''}</option>
          ))}
        </Select>
      </label>
      <Checkbox
        class="settings-field"
        label="Send task context (PR, linked issues, notes) to new agent sessions at startup"
        checked={injectContext()}
        onChange={(e) => void savePref(qc, PrefKeys.startupContextInjection, e.currentTarget.checked ? 'true' : 'false')}
      />
    </>
  )
}
