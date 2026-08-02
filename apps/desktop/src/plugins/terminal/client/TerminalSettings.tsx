import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '@acorn/client-core/queries.ts'
import { savePref } from '@acorn/client-core/settings/savePref.ts'
import { PrefKeys } from '@acorn/client-core/persistence/prefKeys.ts'
import { termFontSize } from '@acorn/client-core/ui/metrics.ts'
import { resolveTerminalFontSize, TERMINAL_FONT_SIZE_OPTIONS } from './preferences'

// Settings → Terminal: the rail-default profile — what the terminal button auto-launches when the
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
        <select
          class="ui-input"
          value={railDefault()}
          onChange={(e) => void savePref(qc, PrefKeys.terminalRailDefault, e.currentTarget.value)}
        >
          <option value="empty">Empty (pick a profile with +)</option>
          <option value="shell">Shell</option>
          <option value="claude-code">Claude Code</option>
          <option value="codex">Codex</option>
        </select>
      </label>
      <label class="settings-field">
        <span class="settings-label">Terminal text size</span>
        <select
          class="ui-input"
          value={String(fontSize())}
          onChange={(e) => void savePref(qc, PrefKeys.terminalFontSize, e.currentTarget.value)}
        >
          {TERMINAL_FONT_SIZE_OPTIONS.map((size) => (
            <option value={String(size)}>{size}px{size === 15 ? ' (default)' : ''}</option>
          ))}
        </select>
      </label>
      <label class="settings-field">
        <span class="settings-label">
          <input
            type="checkbox"
            checked={injectContext()}
            onChange={(e) => void savePref(qc, PrefKeys.startupContextInjection, e.currentTarget.checked ? 'true' : 'false')}
          />
          {' '}Send task context (PR, linked issues, notes) to new agent sessions at startup
        </span>
      </label>
    </>
  )
}
