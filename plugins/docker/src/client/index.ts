import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { registerDockerArchiveConcern } from './archiveConcern'
import { dockerAgentContextContribution } from './agentContextContribution'
import { dockerPrefsSlice } from './dockerPrefs'
import { dockerTaskPollerContribution } from './dockerStore'
import { dockerPaneContribution } from './paneContribution'
import { dockerFooterSlotContribution, dockerRailSlotContribution } from './slotContribution'
import { dockerSourceContribution } from './sourceContribution'

const DockerSettings = lazy(() => import('./DockerSettings'))

export const dockerClientPlugin: ClientPlugin = {
  name: 'docker',
  init: (ctx) => {
    ctx.panes.register(dockerPaneContribution)
    // A local source: no providerId, so no integration row gates it and it is always in the rail.
    ctx.sources.register(dockerSourceContribution)
    ctx.taskSlots.register(dockerFooterSlotContribution)
    ctx.taskSlots.register(dockerRailSlotContribution)
    ctx.pollers.register(dockerTaskPollerContribution)
    ctx.agentContexts.register(dockerAgentContextContribution)
    ctx.persistedState.register(dockerPrefsSlice)
    ctx.settingsPages.register({
      id: 'docker', label: 'Docker', group: 'general', order: 65, component: DockerSettings,
    })
    registerDockerArchiveConcern()
  },
}
