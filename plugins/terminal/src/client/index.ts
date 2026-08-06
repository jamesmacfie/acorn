// The terminal plugin's client part (docs/vNext/plugins.md § The plugin API).
//
// `required: true`, matching the node half.
//
// No PANE: the terminal is a drawer under the pane row, not a pane in it, and App.tsx still renders
// TerminalPanel directly. That is Phase 3's second coupling-table row ("terminal contributes the drawer
// + run integration via slots/capabilities") and it needs a drawer slot the shell does not have yet.
// What this plugin CAN own today is the toggle and its settings page.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/client-core/registries/plugin.ts'
import { terminalAgentContextContribution } from './agentContextContribution'
import { terminalToggleSlotContribution } from './slotContribution'

const TerminalSettings = lazy(() => import('./TerminalSettings'))

export const terminalClientPlugin: ClientPlugin = {
  name: 'terminal',
  required: true,
  init: (ctx) => {
    ctx.slots.register(terminalToggleSlotContribution)
    ctx.agentContexts.register(terminalAgentContextContribution)
    ctx.settingsPages.register({
      id: 'terminal', label: 'Terminal', group: 'general', order: 60, requires: 'desktop',
      component: TerminalSettings,
    })
  },
}
