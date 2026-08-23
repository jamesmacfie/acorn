// What docker has to say when the owner archives a task, and the cleanup it offers to do.
//
// Runs node-side, so the answer comes from the daemon at the moment it is asked and `compose down`
// runs at a known point inside the archive rather than alongside the request.
import type { TaskConcern, TaskRef } from '@acorn/plugin-api/node'
import type { DockerBridge } from '../server/routes/docker'

/** No containers, no row. Archiving a task docker knows nothing about costs one `docker ps`. */
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
