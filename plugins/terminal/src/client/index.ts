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
