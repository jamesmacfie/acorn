// The docker plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// The broadest client surface of any plugin — a rail source, a task pane, two task-slot badges, a
// poller, an agent context, a settings page, a persisted preference slice and an archive concern —
// which is exactly why having it stated in one file is worth more here than anywhere else. All eight
// used to be eight separate lines spread through the app's activate.ts.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
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
    // Activation: contributes a `task:archive` concern (the "also stop its containers" checkbox) into
    // the will-phase handler table, which is a function registry rather than a Registry<T>.
    registerDockerArchiveConcern()
  },
}
