import { lazy } from 'solid-js'
import type { PaneContribution } from '@acorn/client-core/registries/panes.ts'
import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import type { SourceContribution } from '@acorn/client-core/registries/sources.ts'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { linearPaneContribution, rollbarPaneContribution } from './taskPaneContributions'
import { contentLinkRegistry, linearContentLinkContribution, type ContentLinkContribution } from '../../plugins/github/client/contentLinks'
import type { LinearProjectIssue, RollbarItemSummary } from '@acorn/protocol/api.ts'
import { addTaskLink, createTask } from '@acorn/client-core/tasks/mutations.ts'
import { prepareLinearPromotion, prepareRollbarPromotion } from '@acorn/client-core/integrations/providerPromotion.ts'

const LinearBrowse = lazy(() => import('../../plugins/linear/client/LinearBrowse'))
const RollbarBrowse = lazy(() => import('../../plugins/rollbar/client/RollbarBrowse'))

export type ClientIntegrationProviderContribution = {
  id: string
  source: SourceContribution<any>
  pane: PaneContribution
  contentLinks?: ContentLinkContribution[]
}

const providers = new Map<string, ClientIntegrationProviderContribution>()

export function registerIntegrationProvider(contribution: ClientIntegrationProviderContribution): void {
  if (providers.has(contribution.id)) throw new Error(`Integration provider already registered: ${contribution.id}`)
  if (contribution.source.providerId !== contribution.id) throw new Error(`Source '${contribution.source.id}' names the wrong provider.`)
  if (contribution.pane.providerId !== contribution.id) throw new Error(`Pane '${contribution.pane.id}' names the wrong provider.`)
  for (const link of contribution.contentLinks ?? []) {
    if (link.providerId !== contribution.id) throw new Error(`Content link '${link.id}' names the wrong provider.`)
  }
  providers.set(contribution.id, contribution)
  sourceRegistry.register(contribution.source)
  paneRegistry.register(contribution.pane)
  for (const link of contribution.contentLinks ?? []) contentLinkRegistry.register(link)
}

export const clientIntegrationProviders: readonly ClientIntegrationProviderContribution[] = [
  {
    id: 'linear',
    source: {
      id: 'linear', providerId: 'linear', glyph: '◷', label: 'Linear', component: LinearBrowse, defaultPane: 'linear', requiredCapability: 'browse',
      promotion: {
        canPromote: (_item: LinearProjectIssue, context) => !!context.owner && !!context.repo,
        prepare: prepareLinearPromotion,
        create: createTask,
        attachToCurrentTask: (taskId: string, item: LinearProjectIssue) =>
          addTaskLink(taskId, {
            connectionId: item.integrationId,
            identifier: item.identifier,
            ref: { displayId: item.identifier, url: item.url },
          }).then(() => undefined),
      },
    },
    pane: linearPaneContribution,
    contentLinks: [linearContentLinkContribution],
  },
  {
    id: 'rollbar',
    source: {
      id: 'rollbar', providerId: 'rollbar', glyph: '◍', label: 'Rollbar', component: RollbarBrowse, defaultPane: 'rollbar', requiredCapability: 'browse',
      promotion: {
        canPromote: (_item: RollbarItemSummary, context) => !!context.owner && !!context.repo && !!context.branch?.trim(),
        prepare: prepareRollbarPromotion,
        create: createTask,
        attachToCurrentTask: (taskId: string, item: RollbarItemSummary) =>
          addTaskLink(taskId, {
            connectionId: item.integrationId,
            identifier: item.identifier,
            ref: { displayId: item.identifier, ...(item.itemId ? { externalId: item.itemId } : {}) },
          }).then(() => undefined),
      },
    },
    pane: rollbarPaneContribution,
  },
]
