// The terminal plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// `required: true`, matching the node half.
//
// No PANE: the terminal is a drawer under the pane row, not a pane in it. Phase 3 added the shell's
// 'drawer' slot, so the drawer itself is a contribution now (drawerContribution.tsx) rather than something
// App.tsx imports and decides when to show — the second row of plugins.md's coupling table.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { terminalAgentContextContribution } from './agentContextContribution'
import { terminalDrawerContribution } from './drawerContribution'
import { terminalPaletteRowSource } from './paletteRowSource'
import { terminalToggleSlotContribution } from './slotContribution'

const TerminalSettings = lazy(() => import('./TerminalSettings'))

export const terminalClientPlugin: ClientPlugin = {
  name: 'terminal',
  required: true,
  init: (ctx) => {
    ctx.slots.register(terminalToggleSlotContribution)
    ctx.slots.register(terminalDrawerContribution)
    ctx.paletteRows.register(terminalPaletteRowSource)
    ctx.agentContexts.register(terminalAgentContextContribution)
    ctx.settingsPages.register({
      id: 'terminal', label: 'Terminal', group: 'general', order: 60, requires: 'desktop',
      component: TerminalSettings,
    })
  },
}
