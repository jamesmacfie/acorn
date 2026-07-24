// Rail-row marker: a small ◧ when the task has running containers (tabrail.task-row slot).
import { Show } from 'solid-js'
import { dockerTaskSummary } from './dockerStore'
import './docker.css'

export default function DockerRailBadge(props: { taskId: string }) {
  const running = () => dockerTaskSummary(props.taskId)?.running ?? 0
  return (
    <Show when={running() > 0}>
      <span class="tabrail-docker" title={`${running()} running container${running() === 1 ? '' : 's'}`}>◧</span>
    </Show>
  )
}
