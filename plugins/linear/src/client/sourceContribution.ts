import { lazy } from 'solid-js'
import type { LinearProjectIssue } from '../shared/api'
import { prepareLinearPromotion } from './promotion'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'
import { addTaskLink, createTask } from '@acorn/client-core/tasks/mutations.ts'

const LinearBrowse = lazy(() => import('./LinearBrowse'))

export const linearSourceContribution: SourceContribution<LinearProjectIssue> = {
  id: 'linear',
  // Rail position, declared (registries/sources.ts § order). Was implied by this plugin's place in
  // apps/desktop/src/app/client/plugins.ts.
  order: 20,
  providerId: 'linear',
  glyph: '◷',
  label: 'Linear',
  component: LinearBrowse,
  defaultPane: 'linear',
  requiredCapability: 'browse',
  promotion: {
    // A Linear issue carries its own branch name; what it cannot supply is which repo the work lands
    // in, so promotion needs a repo picked in the modal first.
    canPromote: (_item, context) => !!context.projectId,
    prepare: prepareLinearPromotion,
    create: createTask,
    attachToCurrentTask: (taskId, item) =>
      addTaskLink(taskId, {
        connectionId: item.integrationId,
        identifier: item.identifier,
        ref: { displayId: item.identifier, url: item.url },
      }).then(() => undefined),
  },
}
