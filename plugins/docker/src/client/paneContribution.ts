import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/plugin-api/client'
import { dockerTaskSummary } from './dockerStore'

const DockerTaskPane = lazy(() => import('./DockerTaskPane'))

export const dockerPaneContribution: PaneContribution = {
  id: 'docker', label: 'Docker', glyph: 'brand:docker', description: 'Containers linked to this task', order: 75,
  when: (task) => (dockerTaskSummary(task.id)?.total ?? 0) > 0,
  component: DockerTaskPane, minWidth: 320,
}
