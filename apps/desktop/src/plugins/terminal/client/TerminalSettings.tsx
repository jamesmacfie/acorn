import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../../core/client/queries'
import { savePref } from '../../../core/client/settings/savePref'
import { PrefKeys } from '../../../core/client/persistence/prefKeys'

// Settings → Terminal: the rail-default profile — what the terminal button auto-launches when the
// drawer opens empty (TerminalPanel reads `term_rail_default`).
export default function TerminalSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const railDefault = () => prefs.data?.[PrefKeys.terminalRailDefault] ?? 'empty'

  return (
    <label class="settings-field">
      <span class="settings-label">When the terminal button is clicked, open</span>
      <select
        class="integration-key-input"
        value={railDefault()}
        onChange={(e) => void savePref(qc, PrefKeys.terminalRailDefault, e.currentTarget.value)}
      >
        <option value="empty">Empty (pick a profile with +)</option>
        <option value="shell">Shell</option>
        <option value="claude-code">Claude Code</option>
        <option value="codex">Codex</option>
      </select>
    </label>
  )
}
