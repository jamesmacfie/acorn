import { lazy } from 'solid-js'
import type { TaskSlotContribution } from '@acorn/client-core/registries/uiSlots.tsx'

const DockerFooterBadge = lazy(() => import('./DockerFooterBadge'))
const DockerRailBadge = lazy(() => import('./DockerRailBadge'))

export const dockerFooterSlotContribution: TaskSlotContribution = {
  id: 'docker-footer-badge',
  slot: 'task.footer',
  order: 50,
  component: DockerFooterBadge,
}

export const dockerRailSlotContribution: TaskSlotContribution = {
  id: 'docker-rail-badge',
  slot: 'tabrail.task-row',
  order: 50,
  component: DockerRailBadge,
}
