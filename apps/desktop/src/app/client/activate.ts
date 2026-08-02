import { paneRegistry } from '@acorn/client-core/registries/panes.ts'
import { prPaneContribution } from '../../plugins/github/client/pullDetail/PrPane'
import { clientIntegrationProviders, registerIntegrationProvider } from './providerContributions'
import { changesPaneContribution } from '../../plugins/changes/client/paneContribution'
import { notesPaneContribution } from '../../plugins/notes/client/NotesTaskPane'
import { agentPaneContribution } from '../../plugins/agents/client/paneContribution'
import { contextPaneContribution } from '../../plugins/context/client/paneContribution'
import { editorPaneContribution } from '../../plugins/editor/client/paneContribution'
import { searchPaneContribution } from '../../plugins/editor/client/search/paneContribution'
import { databasePaneContribution } from '../../plugins/database/client/paneContribution'
import { previewPaneContribution } from '../../plugins/preview/client/PreviewTaskPane'
import { activatePreviewEvents } from '../../plugins/preview/client/PreviewPane'
import { settingsRegistry } from '@acorn/client-core/registries/settings.ts'
import { settingsPageContributions } from './pageContributions'
import { noticeKindRegistry } from '@acorn/client-core/registries/notices.ts'
import { noticeKindContributions } from '@acorn/client-core/notifications/kindContributions.ts'
import { pollerRegistry } from '@acorn/client-core/registries/pollers.ts'
import { taskStatusPollerContribution } from '@acorn/client-core/tasks/taskStatus.ts'
import { workflowTriggerPollerContribution } from '../../plugins/agents/client/triggerPoller'
import { uiSlotRegistry } from '@acorn/client-core/registries/uiSlots.tsx'
import { shellSlotContributions } from './slotContributions'
import { sourceRegistry } from '@acorn/client-core/registries/sources.ts'
import { dockerSourceContribution } from '../../plugins/docker/client/sourceContribution'
import { dockerPaneContribution } from '../../plugins/docker/client/paneContribution'
import { dockerTaskPollerContribution } from '../../plugins/docker/client/dockerStore'
import { dockerFooterSlotContribution, dockerRailSlotContribution } from '../../plugins/docker/client/slotContribution'
import { httpSourceContribution } from '../../plugins/http/client/sourceContribution'
import { httpPaneContribution } from '../../plugins/http/client/paneContribution'
import { purgeStoredHttpDrafts } from '../../plugins/http/client/draft'
import { registerDockerArchiveConcern } from '../../plugins/docker/client/archiveConcern'
import { taskSlotRegistry } from '@acorn/client-core/registries/uiSlots.tsx'
import { persistedStateRegistry } from '@acorn/client-core/persistence/persistedState.ts'
import { persistedSliceContributions } from './persistedSliceContributions'
import { activateScopedStateEviction } from './scopedEviction'
import { agentContextRegistry } from '@acorn/client-core/registries/agentContexts.ts'
import { taskContextAgentContribution } from '../../plugins/context/client/agentContextContribution'
import { terminalAgentContextContribution } from '../../plugins/terminal/client/agentContextContribution'
import { databaseAgentContextContribution } from '../../plugins/database/client/agentContextContribution'
import { dockerAgentContextContribution } from '../../plugins/docker/client/agentContextContribution'
import { httpAgentContextContribution } from '../../plugins/http/client/agentContextContribution'
import { activateManagedAgentReferences } from '../../plugins/agents/client/referenceContribution'
import { agentCenterSourceContribution } from '../../plugins/agents/client/sourceContribution'
import { agentToolRendererRegistry } from '@acorn/client-core/registries/agentToolRenderers.ts'
import { changesAgentToolRenderer } from '../../plugins/changes/client/agentToolRenderer'
import { activateManagedAgentNotifications } from '../../plugins/agents/client/managedStore'
import { activateManagedAgentNoticeTargets } from '../../plugins/agents/client/managedSelection'

const panes = [
  prPaneContribution,
  agentPaneContribution,
  changesPaneContribution,
  notesPaneContribution,
  contextPaneContribution,
  editorPaneContribution,
  searchPaneContribution,
  databasePaneContribution,
  previewPaneContribution,
  dockerPaneContribution,
  httpPaneContribution,
]

for (const pane of panes) paneRegistry.register(pane)
for (const contribution of [
  taskContextAgentContribution,
  terminalAgentContextContribution,
  databaseAgentContextContribution,
  dockerAgentContextContribution,
  httpAgentContextContribution,
]) agentContextRegistry.register(contribution)
agentToolRendererRegistry.register(changesAgentToolRenderer)
activateManagedAgentReferences()
activateManagedAgentNotifications()
activateManagedAgentNoticeTargets()
for (const provider of clientIntegrationProviders) registerIntegrationProvider(provider)
// Local sources (no integration row): docker and the API panel are always visible in the rail.
sourceRegistry.register(dockerSourceContribution)
sourceRegistry.register(httpSourceContribution)
sourceRegistry.register(agentCenterSourceContribution)
purgeStoredHttpDrafts()
for (const page of settingsPageContributions) settingsRegistry.register(page)
activatePreviewEvents()
for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)
pollerRegistry.register(taskStatusPollerContribution)
pollerRegistry.register(workflowTriggerPollerContribution)
pollerRegistry.register(dockerTaskPollerContribution)
taskSlotRegistry.register(dockerFooterSlotContribution)
taskSlotRegistry.register(dockerRailSlotContribution)
registerDockerArchiveConcern()
for (const contribution of shellSlotContributions) uiSlotRegistry.register(contribution)
for (const slice of persistedSliceContributions) persistedStateRegistry.register(slice)
activateScopedStateEviction()
// Register this window with the public UI control broker (docs/public-api.md) so
// presentation commands from the automation API can drive it. No-op until a public client connects.
