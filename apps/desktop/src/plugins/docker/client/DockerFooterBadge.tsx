// Worktree-footer badge: "◧ N running" when the task has linked containers (task.footer slot).
import { Show } from 'solid-js'
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
          ◧ {s().running}/{s().total} container{s().total === 1 ? '' : 's'}
        </span>
      )}
    </Show>
  )
}
