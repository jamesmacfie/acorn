import { For, Show } from 'solid-js'
import { createQuery } from '@tanstack/solid-query'
import { useNavigate } from '@solidjs/router'
import { projectsOptions, tasksOptions, workspacesOptions } from '../queries'
import { activateTaskSignals, pathForTask } from '../tasks/activate'
import { taskStatus } from '../tasks/taskStatus'
import { workspaceForProject } from './activeWorkspace'

// The core home is deliberately provider-neutral. It is the stable landing source when no optional
// integration is connected; provider plugins contribute their own browse sources beside it.
export default function Home() {
  const navigate = useNavigate()
  const tasks = createQuery(() => tasksOptions(true))
  const projects = createQuery(() => projectsOptions(true))
  const workspaces = createQuery(() => workspacesOptions(true))
  const visibleTasks = () => (tasks.data ?? []).filter((task) => {
    const project = projects.data?.find((candidate) => candidate.id === task.projectId)
    return !project?.hidden
  })

  return (
    <main class="panes home-source">
      <header class="fleet-home-head">
        <h1>Home</h1>
        <p class="muted">Your projects and active tasks.</p>
      </header>
      <Show when={visibleTasks().length} fallback={<p class="muted home-empty">Add a project in Settings to start a task.</p>}>
        <ul class="fleet-cards home-task-list">
          <For each={visibleTasks()}>
            {(task) => {
              const project = () => projects.data?.find((candidate) => candidate.id === task.projectId)
              const workspace = () => workspaceForProject(workspaces.data, task.projectId)
              const status = () => taskStatus(task.id)
              return (
                <li class="fleet-card home-task-card">
                  <button type="button" class="home-task-button" onClick={() => { activateTaskSignals(task); navigate(pathForTask(task)) }}>
                    <span class="home-task-title">{task.title}</span>
                    <span class="muted">{project()?.name ?? 'Project'} · {workspace()?.name ?? 'No workspace'}</span>
                    <Show when={status()?.dirty}><span class="fleet-card-badge">Changes</span></Show>
                  </button>
                </li>
              )
            }}
          </For>
        </ul>
      </Show>
    </main>
  )
}
