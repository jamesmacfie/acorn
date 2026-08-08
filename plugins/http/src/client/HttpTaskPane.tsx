// The API task pane: the same panel as the rail Source, scoped to this task. Requests created here
// stay with the task (an ad-hoc request) until you file them into the project's tree, and the
// {{worktree}} / {{branch}} / {{taskId}} builtins resolve against it — which is the point, since
// every task worktree runs its own dev server on its own port.
import { Show } from 'solid-js'
import type { Task } from '@acorn/client-core/queries.ts'
import { createQuery } from '@tanstack/solid-query'
import { projectsOptions } from '@acorn/client-core/queries.ts'
import HttpPanel from './HttpPanel'
import './http.css'

export default function HttpTaskPane(props: { task: Task }) {
  const projects = createQuery(() => projectsOptions(true))
  const project = () => projects.data?.find((candidate) => candidate.id === props.task.projectId)
  return <Show when={project()} fallback={<p class="placeholder">Loading project…</p>}>
    {(candidate) => <HttpPanel projectId={candidate().id} projectName={candidate().name} taskId={props.task.id} />}
  </Show>
}
