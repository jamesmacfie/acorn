import type { PaneContribution } from '../../../core/client/registries/panes'
import { dockerTaskSummary } from './dockerStore'
import DockerTaskPane from './DockerTaskPane'

export const dockerPaneContribution: PaneContribution = {
  id: 'docker', label: 'Docker', glyph: '◧', description: 'Containers linked to this task', order: 75,
  when: (task) => (dockerTaskSummary(task.id)?.total ?? 0) > 0,
  component: DockerTaskPane, minWidth: 320,
}
