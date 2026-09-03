import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '@acorn/plugin-api/client'
import {
  saveStartupContextInjection,
  saveTerminalFontSize,
  saveTerminalRailDefault,
  startupContextInjection,
  terminalFontSize,
  terminalFontSizeChoices,
  terminalRailDefault,
  TERMINAL_RAIL_DEFAULT_CHOICES,
} from './terminalPrefs'
import { Checkbox, Field, Select, Stack } from '@acorn/plugin-api/ui'

// Settings → Terminal: the rail-default profile, what the terminal button auto-launches when the
// drawer opens empty (TerminalPanel reads `term_rail_default`).
//
// The reads, the writes and the option lists are `./terminalPrefs.ts`, so there is one persistence
// path per value whatever else comes to write one.
export default function TerminalSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))

  return (
    <Stack gap="section">
      <Field label="When the terminal button is clicked, open">
        <Select
          value={terminalRailDefault(prefs.data)}
          onChange={(value) => void saveTerminalRailDefault(qc, value)}
          options={[...TERMINAL_RAIL_DEFAULT_CHOICES]}
        />
      </Field>
      <Field label="Terminal text size">
        <Select
          value={String(terminalFontSize(prefs.data))}
          options={terminalFontSizeChoices()}
          onChange={(value) => void saveTerminalFontSize(qc, value)}
        />
      </Field>
      <Checkbox
        label="Send task context (PR, linked issues, notes) to new agent sessions at startup"
        checked={startupContextInjection(prefs.data)}
        onChange={(checked) => void saveStartupContextInjection(qc, checked)}
      />
    </Stack>
  )
}
