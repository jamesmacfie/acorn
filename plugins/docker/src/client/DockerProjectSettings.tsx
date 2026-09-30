// A project page's Docker tab: the `[docker]` matcher keys that decide which containers a task on this
// project is linked to, as the node reads them from the project's checkout and the home config
// (../server/dockerConfig.ts). Read only: the keys live in `.acorn/config.toml`, a file the repo
// commits, and the tab says where to change them rather than writing a committed file for the person.
import { createResource, Show } from 'solid-js'
import { CodeBlock, SettingRow, SettingsSection, Text } from '@acorn/plugin-api/ui'
import type { DockerMatcherKeys } from '../shared/model'
import { fetchProjectMatcher } from './dockerClient'

type ProjectScope = { context: { scope: { project?: { id: string; name: string; path: string | null } } } }

const KEYS: Array<{ key: keyof DockerMatcherKeys; label: string; description: string; shown: (keys: DockerMatcherKeys) => string }> = [
  {
    key: 'composeProject', label: 'Compose project',
    description: 'Always link this compose project\'s containers to the task.',
    shown: (keys) => keys.composeProject ?? 'None',
  },
  {
    key: 'matchLabels', label: 'Match labels',
    description: 'Label keys whose value equals the task\'s branch slug.',
    shown: (keys) => (keys.matchLabels.length ? keys.matchLabels.join(', ') : 'None'),
  },
  {
    key: 'matchName', label: 'Match container names',
    description: 'Link a container whose name holds the branch slug.',
    shown: (keys) => (keys.matchName ? 'On' : 'Off'),
  },
]

export default function DockerProjectSettings(props: ProjectScope) {
  const [matcher] = createResource(() => props.context.scope.project?.id, fetchProjectMatcher)
  const from = (key: keyof DockerMatcherKeys): string | undefined => {
    const layers = matcher.latest
    if (!layers) return undefined
    if (key in layers.repo) return '.acorn/config.toml'
    if (key in layers.home) return '~/.acorn/config.toml'
    return undefined
  }
  return (
    <SettingsSection
      id="docker-matcher"
      label="Task linking"
      description="Containers started from a task's worktree by compose are linked to it on their own. These keys widen or narrow that match for this project."
    >
      <Show when={!matcher.error} fallback={<Text tone="danger" wrap>Could not read this project's Docker keys from the node.</Text>}>
        <Show when={matcher.latest}>
          {(layers) => KEYS.map((entry) => (
            <SettingRow label={entry.label} description={entry.description} from={from(entry.key)}>
              <Text emphasis="mono">{entry.shown(layers().effective)}</Text>
            </SettingRow>
          ))}
        </Show>
      </Show>
      <SettingRow
        label="Change them"
        description={`Set them in the [docker] table of ${props.context.scope.project?.path ? `${props.context.scope.project.path}/` : 'the project\'s '}.acorn/config.toml. A key the file leaves out falls back to ~/.acorn/config.toml, then to the default.`}
        layout="stacked"
      >
        <CodeBlock size="xs" copy>{`[docker]
compose_project = "myproject"   # always link this compose project's containers
match_labels = ["acorn.task"]   # label keys whose value equals the task's branch slug
match_name = true               # allow the branch-slug-in-name fallback`}</CodeBlock>
      </SettingRow>
    </SettingsSection>
  )
}
