// What docker has to say when the owner archives a task, and the cleanup it offers to do.
//
// Runs node-side. This was a client-side `registerWillHandler` closure reading the polled summary
// store, which had three problems the move fixes: a loaded plugin could never register one, the
// registration went around `ctx` so the host held no disposable for it and it accumulated a copy
// on every re-activation (the dialog drew the row twice), and the teardown fired from the client
// alongside the archive request rather than as a step inside it. Here the answer comes from the
// daemon at the moment it is asked, and `compose down` runs at a known point in the archive.
import type { TaskConcern, TaskRef } from '@acorn/plugin-api/node'
import type { DockerBridge } from '../server/routes/docker'

/** Also the cheapest sentence in the feature: no containers, no row, and every archive of a task
 *  docker knows nothing about costs one `docker ps`. */
export async function dockerArchiveConcern(bridge: DockerBridge, task: TaskRef): Promise<TaskConcern | null> {
  const matched = await bridge.taskContainers(task.id)
  const running = matched.filter((container) => container.state === 'running' || container.state === 'paused' || container.state === 'restarting')
  if (!running.length) return null
  return {
    id: 'containers',
    severity: 'warn',
    message: `${running.length} running container${running.length === 1 ? ' is' : 's are'} linked to this task`,
    details: running.slice(0, 5).map((container) => container.name),
    detailsMore: Math.max(0, running.length - 5),
    action: { label: 'Also stop its containers', checked: true },
  }
}
