// Settings → Docker: whether the daemon answers, the behaviour toggles, and where the per-project
// matcher is set. The [docker] example lives on each project's Docker tab, where those keys are read
// (./DockerProjectSettings.tsx). The sections match the ones `./index.ts` declares for search.
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createResource } from 'solid-js'
import { createSettingSave, prefsOptions } from '@acorn/plugin-api/client'
import type { DockerInfo } from '../shared/model'
import { fetchDockerInfo } from './dockerClient'
import { defaultDockerPrefs, readDockerPrefs, saveDockerPref, type DockerPrefs } from './dockerPrefs'
import { Checkbox, SettingRow, SettingsSection } from '@acorn/plugin-api/ui'

const infoText = (info: DockerInfo): string =>
  info.available
    ? `Running, version ${info.version} (${info.context ?? 'default'})`
    : `Docker isn't available: ${info.detail}`

const SWITCHES: Array<{ key: keyof DockerPrefs; label: string; description?: string }> = [
  { key: 'confirmDestructive', label: 'Ask twice before destructive actions', description: 'Applies to remove, prune, and compose down.' },
  { key: 'showStopped', label: 'Show stopped containers in the Docker list' },
]

export default function DockerSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const current = () => readDockerPrefs(prefs.data)

  const [info] = createResource(fetchDockerInfo)
  // Through the shared merge: both switches share one key, so an unmerged write would drop the other
  // one (./dockerPrefs.ts). One save state per switch, so an error lands on the row that failed.
  const saves = { confirmDestructive: createSettingSave(), showStopped: createSettingSave() }
  const write = (key: keyof DockerPrefs, value: boolean) =>
    saves[key].run(() => saveDockerPref(qc, prefs.data, key, value))

  return (
    <>
      <SettingsSection id="daemon" label="Status">
        {/* The engine's state is the row's description, under its name, rather than text floating in
            the control column. By state rather than a read: a read would hold the whole page blank
            until the daemon answers, and a failed one would take the page down with it. */}
        <SettingRow
          label="Docker engine"
          description={info.state === 'ready' ? infoText(info()) : info.state === 'errored' ? "Couldn't get Docker's status." : 'Checking Docker…'}
        />
      </SettingsSection>

      <SettingsSection id="behaviour" label="Behaviour">
        {SWITCHES.map((item) => (
          <SettingRow
            label={item.label}
            description={item.description}
            error={saves[item.key].error()}
            // Both defaults are constants in ./dockerPrefs.ts, which is what a record with nothing stored reads.
            onReset={current()[item.key] === defaultDockerPrefs[item.key]
              ? undefined
              : () => write(item.key, defaultDockerPrefs[item.key])}
          >
            <Checkbox
              switch
              ariaLabel={item.label}
              checked={current()[item.key]}
              onChange={(checked) => write(item.key, checked)}
            />
          </SettingRow>
        ))}
      </SettingsSection>

      <SettingsSection
        id="linking"
        label="Task linking"
        help="acorn links a task to the containers of a Compose stack started in its worktree. To start and stop a stack from the task, add it as a run target."
      >
        <SettingRow label="Project rules" description="Set in each project's .acorn/config.toml. The project's Docker tab shows them." />
      </SettingsSection>
    </>
  )
}
