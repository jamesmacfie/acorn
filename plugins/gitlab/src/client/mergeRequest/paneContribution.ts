import { lazy } from 'solid-js'
import type { PaneLayoutContribution } from '@acorn/plugin-api/client'
import { mergeRequestUrl } from '../../shared/mergeRequestRef'
import { taskMergeRequest } from '../clientRoutes'

// The `mr` pane's registration, apart from the pane, so the pane and the review views behind it stay
// out of the first paint.
const MrPane = lazy(async () => ({ default: (await import('./MrPane')).MrPane }))

export const mrPaneContribution: PaneLayoutContribution = {
  id: 'mr',
  label: 'Merge request',
  glyph: 'git-pull-request',
  description: 'Details, files, and diff',
  order: 10,
  defaultChord: 'meta+shift+m',
  when: (task) => !!taskMergeRequest(task),
  url: (task) => {
    const at = taskMergeRequest(task)
    return at ? mergeRequestUrl(at.path, at.number) : undefined
  },
  minWidth: 520,
  layout: 'single',
  regions: { body: MrPane },
}
