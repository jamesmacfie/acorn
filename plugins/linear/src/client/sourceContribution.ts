// The Linear rail Source: browse a project's issues, and promote one into a task.
//
// Gated by `providerId`, unlike docker's and http's: the rail shows it only when a connected Linear
// integration with the `browse` capability exists (client-core/tabs/sources.ts). The plugin host
// asserts that this `providerId` is the plugin's own name, which is the check the app's deleted
// registerIntegrationProvider used to run over exactly these two providers.
import { lazy } from 'solid-js'
import type { LinearProjectIssue } from '@acorn/protocol/api.ts'
import { prepareLinearPromotion } from '@acorn/client-core/integrations/providerPromotion.ts'
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
    canPromote: (_item, context) => !!context.owner && !!context.repo,
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
