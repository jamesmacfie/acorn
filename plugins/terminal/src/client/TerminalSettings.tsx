import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSettingSave, prefsOptions, termFontSize } from '@acorn/plugin-api/client'
import {
  saveTerminalFontSize,
  saveTerminalRailDefault,
  terminalFontSize,
  terminalFontSizeChoices,
  terminalRailDefault,
  TERMINAL_RAIL_DEFAULT_CHOICES,
} from './terminalPrefs'
import { Select, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'

// Settings → Terminal: the rail-default profile, what the terminal button auto-launches when the
// drawer opens empty (TerminalPanel reads `term_rail_default`), and the text size. The section matches
// the one `./index.ts` declares for search. Whether a new agent session is sent the task's context is
// on Agents → Harnesses and defaults, beside the rest of what a session starts with.
//
// The reads, the writes and the option lists are `./terminalPrefs.ts`, so there is one persistence
// path per value whatever else comes to write one.
export default function TerminalSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const railDefault = createSettingSave()
  const fontSize = createSettingSave()

  return (
    <>
      <SettingsSection id="drawer" label="Drawer">
        <SettingRow label="When the terminal button is clicked, open" error={railDefault.error()}>
          <Select
            label="When the terminal button is clicked, open"
            value={terminalRailDefault(prefs.data)}
            onChange={(value) => void railDefault.run(() => saveTerminalRailDefault(qc, value))}
            options={[...TERMINAL_RAIL_DEFAULT_CHOICES]}
          />
        </SettingRow>
        <SettingRow
          label="Text size"
          error={fontSize.error()}
          // The default is the style's own size, which is what the terminal draws with nothing stored.
          onReset={terminalFontSize(prefs.data) === termFontSize()
            ? undefined
            : () => void fontSize.run(() => saveTerminalFontSize(qc, String(termFontSize())))}
        >
          <Select
            label="Text size"
            value={String(terminalFontSize(prefs.data))}
            options={terminalFontSizeChoices()}
            onChange={(value) => void fontSize.run(() => saveTerminalFontSize(qc, value))}
          />
        </SettingRow>
      </SettingsSection>
    </>
  )
}
