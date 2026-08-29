import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { PrefKeys, prefsOptions, savePref, termFontSize } from '@acorn/plugin-api/client'
import { resolveTerminalFontSize, TERMINAL_FONT_SIZE_OPTIONS } from './preferences'
import { Checkbox, Field, Select, Stack } from '@acorn/plugin-api/ui'

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
    <Stack gap="section">
      <Field label="When the terminal button is clicked, open">
        <Select
          value={railDefault()}
          onChange={(value) => void savePref(qc, PrefKeys.terminalRailDefault, value)}
          options={[
            { value: 'empty', label: 'Empty (pick a profile with +)' },
            { value: 'shell', label: 'Shell' },
            { value: 'claude-code', label: 'Claude Code' },
            { value: 'codex', label: 'Codex' },
          ]}
        />
      </Field>
      <Field label="Terminal text size">
        <Select
          value={String(fontSize())}
          options={TERMINAL_FONT_SIZE_OPTIONS.map((size) => ({
            value: String(size),
            label: `${size}px${size === 15 ? ' (default)' : ''}`,
          }))}
          onChange={(value) => void savePref(qc, PrefKeys.terminalFontSize, value)}
        />
      </Field>
      <Checkbox
        label="Send task context (PR, linked issues, notes) to new agent sessions at startup"
        checked={injectContext()}
        onChange={(checked) => void savePref(qc, PrefKeys.startupContextInjection, checked ? 'true' : 'false')}
      />
    </Stack>
  )
}
