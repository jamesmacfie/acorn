import type { PaneContribution } from '../../registries/panes'
import { paneRegistry } from '../../registries/panes'
import type { SourceContribution } from '../../registries/sources'
import { sourceRegistry } from '../../registries/sources'
import LinearBrowse from '../tasks/LinearBrowse'
import RollbarBrowse from '../tasks/RollbarBrowse'
import { linearPaneContribution, rollbarPaneContribution } from './taskPaneContributions'
import { contentLinkRegistry, linearContentLinkContribution, type ContentLinkContribution } from '../../contentLinks'
import type { LinearProjectIssue, RollbarItem } from '../../../shared/api'
import { addTaskLink, createTask } from '../../mutations'
import { prepareLinearPromotion, prepareRollbarPromotion } from './providerPromotion'

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
        canPromote: (_item: RollbarItem, context) => !!context.owner && !!context.repo && !!context.branch?.trim(),
        prepare: prepareRollbarPromotion,
        create: createTask,
        attachToCurrentTask: (taskId: string, item: RollbarItem) =>
          addTaskLink(taskId, { connectionId: item.integrationId, identifier: item.identifier, ref: { displayId: item.identifier } }).then(() => undefined),
      },
    },
    pane: rollbarPaneContribution,
  },
]
