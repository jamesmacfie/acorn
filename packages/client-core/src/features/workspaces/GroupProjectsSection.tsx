import { createSignal } from 'solid-js'
import { useQueryClient } from '@tanstack/solid-query'
import { WORKSPACES_PREF_KEY } from '@acorn/protocol/workspacesMode.ts'
import { activeNodeId } from '../../infra/node/activeNode'
import { ConfirmButton } from '../../kit/components/inputs/ConfirmButton'
import { SettingRow } from '../../kit/components/layout/SettingRow'
import { SettingsSection } from '../../kit/components/layout/SettingsSection'
import { patchCachedPrefs, setPref } from '../settings/savePref'
import { createSettingSave } from '../settings/settingSave'

/** Mounted per Node while grouping is off. The irreversible write must succeed before labels change. */
export function GroupProjectsSection() {
  const client = useQueryClient()
  const nodeId = activeNodeId()
  const save = createSettingSave()
  const [busy, setBusy] = createSignal(false)
  const group = async () => {
    if (busy()) return
    setBusy(true)
    try {
      await save.run(async () => {
        await setPref(WORKSPACES_PREF_KEY, 'on', nodeId)
        patchCachedPrefs(client, (prefs) => ({ ...prefs, [WORKSPACES_PREF_KEY]: 'on' }))
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingsSection id="group-projects" label="Group projects into workspaces">
      <SettingRow
        label="Group projects"
        description="Put several projects in one workspace so they share a task list, notes, and dashboards. Each project you have now becomes its own workspace. You can't switch back to separate projects."
        error={save.error()}
      >
        <ConfirmButton
          disabled={busy()}
          confirmLabel="Group projects? This can't be undone."
          onConfirm={() => void group()}
        >
          Group projects
        </ConfirmButton>
      </SettingRow>
    </SettingsSection>
  )
}
