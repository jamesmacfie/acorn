// Settings → Docker: daemon availability readout + behaviour toggles + the [docker] config
// reference (per-repo matcher overrides live in .acorn/config.toml, and each project's page shows its
// own in a Docker tab, ./DockerProjectSettings.tsx). The sections match the
// ones `./index.ts` declares for search.
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createResource, Show } from 'solid-js'
import { createSettingSave, prefsOptions } from '@acorn/plugin-api/client'
import type { DockerInfo } from '../shared/model'
import { fetchDockerInfo } from './dockerClient'
import { defaultDockerPrefs, readDockerPrefs, saveDockerPref, type DockerPrefs } from './dockerPrefs'
import { Checkbox, CodeBlock, SettingRow, SettingsSection, Text } from '@acorn/plugin-api/ui'

const infoText = (info: DockerInfo): string =>
  info.available
    ? `Connected — engine ${info.version}, context ${info.context ?? 'default'}.`
    : `Unavailable — ${info.detail}`

const SWITCHES: Array<{ key: keyof DockerPrefs; label: string; description?: string }> = [
  { key: 'confirmDestructive', label: 'Ask twice before destructive actions', description: 'Remove, prune and compose down.' },
  { key: 'showStopped', label: 'Show stopped containers in the Docker source' },
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
      <SettingsSection id="daemon" label="Daemon">
        <SettingRow label="Docker engine">
          <Text emphasis="muted" wrap>
            {/* By state rather than a read: a read would hold the whole page blank until the daemon
                answers, and a failed one would take the page down with it. */}
            <Show
              when={info.state === 'ready' ? info() : undefined}
              fallback={info.state === 'errored' ? 'Could not ask this node about its Docker daemon.' : 'Checking the daemon…'}
            >
              {(i) => infoText(i())}
            </Show>
          </Text>
        </SettingRow>
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
        description="Task↔container linking is automatic for compose stacks started in a task worktree. Stack commands (start/stop/dev servers) belong in [scripts.run.*] run targets, which get the trust gate and the run buttons on the task."
      >
        <SettingRow label="Per-repo matcher" description="Set in .acorn/config.toml. Each project's settings page has a Docker tab showing what its checkout sets." layout="stacked">
          <CodeBlock size="xs" copy>{`[docker]
compose_project = "myproject"   # always link this compose project's containers
match_labels = ["acorn.task"]   # label keys whose value equals the task's branch slug
match_name = true               # allow the branch-slug-in-name fallback`}</CodeBlock>
        </SettingRow>
      </SettingsSection>
    </>
  )
}
