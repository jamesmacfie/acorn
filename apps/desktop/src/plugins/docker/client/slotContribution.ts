import type { TaskSlotContribution } from '../../../core/client/registries/uiSlots'
import DockerFooterBadge from './DockerFooterBadge'
import DockerRailBadge from './DockerRailBadge'

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
