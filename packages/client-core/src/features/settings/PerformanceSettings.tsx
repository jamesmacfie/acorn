import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { prefsOptions } from '../../infra/queries'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { DEFAULT_KEPT_TASKS, KEPT_TASK_CHOICES, keptTasks } from '../../host/registries/panes/paneModels'
import { Select } from '../../kit/components/primitives'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { createSettingSave } from './settingSave'
import { savePref } from './savePref'

// Settings > Performance: how much this device keeps in memory to make going back fast.
const choices = KEPT_TASK_CHOICES.map((count) => ({
  value: String(count),
  label: count === 1 ? 'Only the task on screen' : `The last ${count} tasks`,
}))

export default function PerformanceSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const kept = createSettingSave()
  const save = (value: number) => void kept.run(() => savePref(qc, PrefKeys.keptTasks, String(value)))
  return (
    <SettingsSection id="memory" label="Memory">
      <SettingRow
        label="Keep task state in memory"
        help="Each pane keeps what you were doing in this many recent tasks: open files with their undo history and scroll, the note you were editing, and lists you filtered. Going back to one of them finds it as you left it. An older task opens from what was saved, so its files, scroll, and cursor come back, and its undo history doesn't."
        scope="device"
        error={kept.error()}
        onReset={keptTasks(prefs.data) === DEFAULT_KEPT_TASKS ? undefined : () => save(DEFAULT_KEPT_TASKS)}
      >
        <Select
          label="Keep task state in memory"
          value={String(keptTasks(prefs.data))}
          options={choices}
          onChange={(value) => save(Number(value))}
        />
      </SettingRow>
    </SettingsSection>
  )
}
