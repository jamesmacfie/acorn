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

// The rail-row marker used to be a component in a `tabrail.task-row` slot, which meant Docker
// positioning itself in the shell's pixel geography from its own stylesheet. It publishes the state
// now and the host decides where it lands, so it can no longer collide with core's pin.
export const dockerRailMarkerContribution: RailMarkerContribution = {
  id: 'docker',
  order: 50,
  markers: (target) => {
    if (target.kind !== 'task') return []
    const running = dockerTaskSummary(target.id)?.running ?? 0
    if (!running) return []
    return [{
      id: 'running',
      label: `${running} running container${running === 1 ? '' : 's'}`,
      icon: 'brand:docker',
      tone: 'accent',
      placements: ['top-start', 'bottom-start'],
    }]
  },
}
