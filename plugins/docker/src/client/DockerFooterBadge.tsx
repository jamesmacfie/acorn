// Worktree-footer badge: the Docker mark and "N running" when the task has linked containers
// (task.footer slot).
import { Show } from 'solid-js'
import { Icon, Inline, Text } from '@acorn/plugin-api/ui'
import { dockerTaskSummary } from './dockerStore'

export default function DockerFooterBadge(props: { taskId: string }) {
  const summary = () => dockerTaskSummary(props.taskId)
  return (
    <Show when={summary()}>
      {(s) => (
        <Inline gap="inline">
          <Icon name="brand:docker" />
          {/* Muted until something is actually running, which is the whole signal the badge carries. */}
          <Text emphasis={s().running > 0 ? 'body' : 'muted'}>
            {s().running}/{s().total} container{s().total === 1 ? '' : 's'}
          </Text>
        </Inline>
      )}
    </Show>
  )
}
