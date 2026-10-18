import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createSettingSave, prefsOptions, savePref } from '@acorn/plugin-api/client'
import { Checkbox, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'
import { MEMORY_LIVE_UPDATES_KEY } from '../shared/api'

export default function MemorySettings() {
  const queryClient = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const save = createSettingSave()
  return (
    <SettingsSection id="sessions" label="Running sessions">
      <SettingRow
        label="Tell running sessions when memory changes"
        description="When a memory is added, changed, or removed, a session that's already running gets a short note on its next message."
        error={save.error()}
      >
        <Checkbox
          switch
          ariaLabel="Tell running sessions when memory changes"
          checked={prefs.data?.[MEMORY_LIVE_UPDATES_KEY] !== '0'}
          onChange={(enabled) => save.run(() => savePref(queryClient, MEMORY_LIVE_UPDATES_KEY, enabled ? '1' : '0'))}
        />
      </SettingRow>
    </SettingsSection>
  )
}
