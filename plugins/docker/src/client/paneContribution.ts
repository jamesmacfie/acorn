import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { dockerTaskSummary } from './dockerStore'

// `header-body`, which is `header-body-footer` with no footer: the chip strip stays put and the
// container detail below it scrolls (docs/panes.md § Layout model).
const DockerChips = lazy(async () => ({ default: (await import('./DockerTaskPane')).DockerChips }))
const DockerTaskDetail = lazy(async () => ({ default: (await import('./DockerTaskPane')).DockerTaskDetail }))

export const dockerPaneContribution: PaneLayoutContribution = {
  id: 'docker', label: 'Docker', glyph: 'brand:docker', description: 'Containers linked to this task', order: 75,
  when: (task) => (dockerTaskSummary(task.id)?.total ?? 0) > 0,
  minWidth: 320,
  layout: 'header-body-footer',
  regions: { header: DockerChips, body: DockerTaskDetail },
}
