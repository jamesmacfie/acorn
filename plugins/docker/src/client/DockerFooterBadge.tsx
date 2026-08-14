// Worktree-footer badge: the Docker mark and "N running" when the task has linked containers
// (task.footer slot).
import { Show } from 'solid-js'
import { Icon } from '@acorn/plugin-api/ui'
import { dockerTaskSummary } from './dockerStore'
import './docker.css'

export default function DockerFooterBadge(props: { taskId: string }) {
  const summary = () => dockerTaskSummary(props.taskId)
  return (
    <Show when={summary()}>
      {(s) => (
        <span
          class="workspace-footer-docker"
          classList={{ 'docker-footer-running': s().running > 0 }}
          title={s().projects.length ? `Compose: ${s().projects.join(', ')}` : 'Linked containers'}
        >
          <Icon name="brand:docker" /> {s().running}/{s().total} container{s().total === 1 ? '' : 's'}
        </span>
      )}
    </Show>
  )
}
