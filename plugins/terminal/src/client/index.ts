import { lazy } from 'solid-js'
import { registerNoticeTargetHandler, setTerminalOpen, type ClientPlugin } from '@acorn/plugin-api/client'
import { terminalAgentContextContribution } from './agentContextContribution'
import { terminalDrawerContribution } from './drawerContribution'
import { terminalCommands } from './commands'
import { activeTerminal, initSessions, refreshSessions, rememberActiveTerminal, requestTerminalFocus, sessionNode, sessions } from './sessionStore'
import { terminalApi } from './terminalClient'
import { initPtyChannel } from './wsChannel'
import { installTerminalHostClient } from '../contract/hostClient'


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
      id: 'terminal', label: 'Terminal', category: 'features', scope: 'device', icon: 'terminal', order: 10, requires: { plugin: 'terminal' },
      // The page's sections and rows, for search (TerminalSettings.tsx draws the same ones).
      keywords: ['shell', 'pty', 'font'],
      sections: [
        { id: 'drawer', label: 'Drawer', rows: ['When the terminal button is clicked, open', 'Text size'] },
      ],
      component: TerminalSettings,
    })
  },
  // "claude needs you" for a PTY agent points at a terminal session, and only this plugin knows
  // that opening one means opening the drawer on its tab.
  activate: (ctx) => {
    const stopPty = initPtyChannel()
    const stop = initSessions()
    const stopHost = installTerminalHostClient({
      api: terminalApi(), sessions, sessionNode, refreshSessions,
      activeTerminal, rememberActiveTerminal,
    })
    const stopNotice = registerNoticeTargetHandler('terminal-session', (taskId, target) => {
      setTerminalOpen(taskId, true)
      rememberActiveTerminal(taskId, target.resourceId)
      requestTerminalFocus(taskId, target.resourceId)
    })
    ctx.sessionSources.register({
      summaries: () => sessions().flatMap((session) => sessionNode() === null ? [] : [{
        nodeId: sessionNode()!, sessionId: session.id, taskId: session.taskId,
        title: session.title, running: session.status === 'running', createdAt: session.createdAt,
        agent: session.kind === 'agent', idle: session.idle,
      }]),
      send: (id, text, submit) => terminalApi().send(id, text, submit),
      refresh: refreshSessions,
      focus: (id, taskId) => { setTerminalOpen(taskId, true); rememberActiveTerminal(taskId, id); requestTerminalFocus(taskId, id) },
      dispose: () => { stopNotice(); stopHost(); stop(); stopPty() },
    })
  },
}
