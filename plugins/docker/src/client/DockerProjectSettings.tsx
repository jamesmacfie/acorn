// A project page's Docker tab: the `[docker]` hints for the device's task summary,
// as the node reads them from the project's checkout and the home config
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
    description: 'Suggest this Compose project in the task summary when container worktree metadata is absent.',
    shown: (keys) => keys.composeProject ?? 'None',
  },
  {
    key: 'matchLabels', label: 'Match labels',
    description: 'Label keys whose value equals the task\'s branch slug.',
    shown: (keys) => (keys.matchLabels.length ? keys.matchLabels.join(', ') : 'None'),
  },
  {
    key: 'matchName', label: 'Match container names',
    description: 'Suggest containers whose names contain the branch slug.',
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
      description="Compose worktree metadata determines task listings and cleanup. These keys add hints to the task summary; they do not authorize cleanup."
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
compose_project = "myproject"   # suggest this project in the task summary
match_labels = ["acorn.task"]   # label keys whose value equals the task's branch slug
match_name = true               # allow the branch-slug-in-name fallback`}</CodeBlock>
      </SettingRow>
    </SettingsSection>
  )
}
