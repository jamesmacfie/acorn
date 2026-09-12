import { lazy } from 'solid-js'
import { registerNoticeTargetHandler, rememberActiveTerminal, requestTerminalFocus, setTerminalOpen, type ClientPlugin } from '@acorn/plugin-api/client'
import { terminalAgentContextContribution } from './agentContextContribution'
import { terminalDrawerContribution } from './drawerContribution'
import { terminalCommands } from './commands'

const TerminalSettings = lazy(() => import('./TerminalSettings'))

export const terminalClientPlugin: ClientPlugin = {
  name: 'terminal',
  required: true,
  init: (ctx) => {
    ctx.slots.register(terminalDrawerContribution)
    // The task's run targets, layout recipes and live terminals, as three searches under one group
    // (./commands.ts). A `paletteRows` source until 2026-09-03.
    for (const contribution of terminalCommands) ctx.commands.register(contribution)
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
