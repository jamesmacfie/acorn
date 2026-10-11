import { lazy } from 'solid-js'
import type { RailMarkerContribution, TaskSlotContribution } from '@acorn/plugin-api/client'
import { dockerTaskSummary } from './dockerStore'

const DockerFooterBadge = lazy(() => import('./DockerFooterBadge'))

export const dockerFooterSlotContribution: TaskSlotContribution = {
  id: 'docker-footer-badge',
  slot: 'task.footer',
  order: 50,
  component: DockerFooterBadge,
}

// Docker publishes the rail marker's state and the host decides where it lands, so it cannot collide
// with core's pin.
export const dockerRailMarkerContribution: RailMarkerContribution = {
  id: 'docker',
  order: 50,
  markers: (target) => {
    // The task's rail row, and the Docker button in that task's pane rail.
    const taskId =
      target.kind === 'task' ? target.id : target.kind === 'pane' && target.id === 'docker' ? target.taskId : null
    if (!taskId) return []
    const running = dockerTaskSummary(taskId)?.running ?? 0
    if (!running) return []
    return [
      {
        id: 'running',
        label: `${running} running container${running === 1 ? '' : 's'}`,
        tone: 'accent',
        // A green dot in the top-right corner of the Docker button, whose own glyph is already the whale.
        ...(target.kind === 'pane'
          ? { dotTone: 'ok' as const, placements: ['top-end'] as const }
          : { icon: 'brand:docker', placements: ['top-start', 'bottom-start'] as const }),
      },
    ]
  },
}
