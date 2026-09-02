import { lazy } from 'solid-js'
import { registerNoticeTargetHandler, rememberActiveTerminal, requestTerminalFocus, setTerminalOpen, type ClientPlugin } from '@acorn/plugin-api/client'
import { terminalAgentContextContribution } from './agentContextContribution'
import { terminalDrawerContribution } from './drawerContribution'
import { terminalPaletteRowSource } from './paletteRowSource'

const TerminalSettings = lazy(() => import('./TerminalSettings'))

export const terminalClientPlugin: ClientPlugin = {
  name: 'terminal',
  required: true,
  init: (ctx) => {
    ctx.slots.register(terminalDrawerContribution)
    ctx.paletteRows.register(terminalPaletteRowSource)
    ctx.agentContexts.register(terminalAgentContextContribution)
    ctx.settingsPages.register({
      id: 'terminal', label: 'Terminal', group: 'general', order: 60, requires: { plugin: 'terminal' },
      component: TerminalSettings,
    })
  },
  // "claude needs you" for a PTY agent points at a terminal session, and only this plugin knows
  // that opening one means opening the drawer on its tab.
  activate: () => {
    registerNoticeTargetHandler('terminal-session', (taskId, target) => {
      setTerminalOpen(taskId, true)
      rememberActiveTerminal(taskId, target.resourceId)
      requestTerminalFocus(taskId, target.resourceId)
    })
  },
}
