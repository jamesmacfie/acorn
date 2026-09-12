// Settings → Docker: daemon availability readout + behaviour toggles + the [docker] config
// reference (per-repo matcher overrides live in .acorn/config.toml, not here).
import { createQuery, useQueryClient } from '@tanstack/solid-query'
import { createResource, Show } from 'solid-js'
import { prefsOptions } from '@acorn/plugin-api/client'
import type { DockerInfo } from '../shared/model'
import { fetchDockerInfo } from './dockerClient'
import { readDockerPrefs, saveDockerPref, type DockerPrefs } from './dockerPrefs'
import { Checkbox, CodeBlock, Stack, Text } from '@acorn/plugin-api/ui'

const infoText = (info: DockerInfo): string =>
  info.available
    ? `Connected — engine ${info.version}, context ${info.context ?? 'default'}.`
    : `Unavailable — ${info.detail}`

export default function DockerSettings() {
  const qc = useQueryClient()
  const prefs = createQuery(() => prefsOptions(true))
  const current = () => readDockerPrefs(prefs.data)

  const [info] = createResource(fetchDockerInfo)
  // Through the shared merge: both switches share one key, so an unmerged write would drop the other
  // one (./dockerPrefs.ts).
  const toggle = (key: keyof DockerPrefs) => void saveDockerPref(qc, prefs.data, key, !current()[key])

  return (
    <Stack gap="section">
      <Text emphasis="muted" wrap>
        <Show when={info()} fallback={'Checking the daemon…'}>{(i) => infoText(i())}</Show>
      </Text>

      <Checkbox
        label="Ask twice before destructive actions (remove, prune, compose down)"
        checked={current().confirmDestructive}
        onChange={() => toggle('confirmDestructive')}
      />
      <Checkbox
        label="Show stopped containers in the Docker source"
        checked={current().showStopped}
        onChange={() => toggle('showStopped')}
      />

      <Text emphasis="muted" wrap>
        Task↔container linking is automatic for compose stacks started in a task worktree. Repos can
        tune the matcher in <Text emphasis="mono">.acorn/config.toml</Text>:
      </Text>
      <CodeBlock size="xs" copy>{`[docker]
compose_project = "myproject"   # always link this compose project's containers
match_labels = ["acorn.task"]   # label keys whose value equals the task's branch slug
match_name = true               # allow the branch-slug-in-name fallback`}</CodeBlock>
      <Text emphasis="muted" wrap>
        Stack commands (start/stop/dev servers) belong in <Text emphasis="mono">[scripts.run.*]</Text> run
        targets — they get the trust gate and the run buttons on the task.
      </Text>
    </Stack>
  )
}
