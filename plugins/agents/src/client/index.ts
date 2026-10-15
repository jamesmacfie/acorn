// The agents plugin's client part (docs/plugins/plugin-api.md § The plugin API).
//
// `required: true`, matching the node half: the Agent pane and the Agent Center rail source are what
// the managed-agent runtime is for, and core's task view falls back to a pane list that assumes they
// exist.
import { lazy } from 'solid-js'
import type { ClientPlugin } from '@acorn/plugin-api/client'
import { CORE_PLUGIN_PAGE_POINT, CORE_SECURITY_POINT, CORE_STORAGE_POINT } from '@acorn/protocol/extensionPoints.ts'
import { AGENTS_CONVERSATION } from '../contract/conversation'
import { AGENTS_INLINE_DIFF } from '../contract/inlineDiffClient.ts'
import { isStale, reportPatches } from './inlineDiff/patchStatus.ts'
import { installManagedHandoff } from '../contract/handoffClient'
import { ATTENTION_COPY, isActiveAgent, needsAttention } from './sessions/agentActivity'
import { managedAgentApi } from './sessions/managedClient'
import {
  activateManagedAgentNoticeTargets,
  activateManagedAgentPaneIntents,
  agentAttentionItemId,
} from './sessions/managedSelection'
import { activateManagedAgentNotifications, managedAgentStore } from './sessions/managedStore'
import { clearableAgents, markAgentsRead } from './sessions/markAgentsRead'
import { agentPaneContribution } from './paneContribution'
import { agentRailMarkerContribution } from './railMarkerContribution'
import { managedReferenceTarget } from './referenceContribution'
import { agentCenterSourceContribution } from './sourceContribution'
import { agentsCommands } from './commands'
import { agentCommandsSlotContribution } from './AgentCommands'
import { harnessTerminalCommands } from './terminalProfileCommands'
import { agentToolFoldSlice } from './sessions/toolFoldPrefs'
import { sessionOrderSlice } from './sessions/sessionOrder'
import { PROVIDER_MARKS } from '../contract/providerMarks.ts'
import { composerExpansionSlice } from './composer/composerPrefs'
import { sessionContextContribution } from './sessionContextContribution'

// The conversation, for whoever else has a session to draw (`AGENTS_CONVERSATION`). Lazy like the
// settings pages below: the Workflows run pane is the only other caller and most windows never open
// one, and the terminal client holds a byte ceiling over what loads at startup
// (apps/tui/scripts/check-startup-graph.mjs).
const AgentConversation = lazy(() => import('./sessions/AgentConversation'))
const InlineDiffCard = lazy(() => import('./inlineDiff/InlineDiffCard.tsx'))
const AgentLimitsSettings = lazy(() => import('./settings/AgentLimitsSettings'))
const AgentSessionDefaultsSettings = lazy(() => import('./settings/AgentSessionDefaultsSettings'))
const McpSettingsPage = lazy(() => import('./settings/McpSettingsPage'))
const CustomAgentsSettings = lazy(() => import('./settings/CustomAgentsSettings'))
const AgentStorageSection = lazy(() => import('./settings/AgentStorageSection'))
const AgentSecuritySection = lazy(() => import('./settings/AgentSecuritySection'))
const LoopCoverageSection = lazy(() => import('./settings/LoopCoverageSection'))

export const agentsClientPlugin: ClientPlugin = {
  name: 'agents',
  required: true,
  init: (ctx) => {
    ctx.contentLinks.register({
      id: 'agents.session',
      providerId: 'agents',
      parse: () => null,
      target: (item) => ({ kind: 'agents.session', item, pane: 'agent' }),
      presentations: ['pane'],
    })
    for (const mark of PROVIDER_MARKS) ctx.brandMarks.register(mark)
    ctx.panes.register(agentPaneContribution)
    ctx.agentContexts.register(sessionContextContribution)
    ctx.referenceTargets.register(managedReferenceTarget)
    // Anyone with a session id, or with the id of a workflow step that started one, can draw its
    // conversation. The run pane uses it to hold the transcript, the queue and the composer for the
    // node it has selected, so a step reads the same way in either place.
    ctx.capabilities.provide(AGENTS_CONVERSATION, { Conversation: AgentConversation })
    ctx.capabilities.provide(AGENTS_INLINE_DIFF, {
      prime: (taskId) => {
        void managedAgentStore.loadTask(taskId).catch(() => undefined)
      },
      sessionsForTask: managedAgentStore.sessionsForTask,
      reportPatches,
      isStale,
      Card: InlineDiffCard,
    })
    // The places another plugin may come into this pane
    // (docs/plugins/cooperative-extension-points.md § Cooperative extension points). The tool card is
    // keyed by the harness's own name for what a call did; the attachment chip by the file's media type;
    // the composer's action bar takes everyone who has something to offer a draft, up to the owner's
    // ceiling because it is the owner's bar.
    ctx.extensionPoints.register({
      id: 'tool-card',
      label: 'Agent tool call',
      kind: 'remote',
      mode: 'replace',
      max: 1,
    })
    // `replace` is the one thing a contributor may ask this pane to do
    // (docs/plugins/remote-points.md § Asking the owner). An editor that draws an attachment has to be
    // able to hand back an altered one, and props are data, so without a declared action it could draw
    // the button and never do anything with it. The composer binds the handler per attachment and
    // decides whether to accept.
    ctx.extensionPoints.register({
      id: 'attachment',
      label: 'Agent turn attachment',
      kind: 'remote',
      mode: 'replace',
      max: 1,
      actions: ['replace'],
    })
    // The body of a sent attachment's tile and of an artifact card, keyed by media type. No actions:
    // stored media is read-only, and the card keeps its name, size and download outside the slot.
    ctx.extensionPoints.register({
      id: 'transcript-attachment',
      label: 'Sent attachment',
      kind: 'remote',
      mode: 'replace',
      max: 1,
    })
    ctx.extensionPoints.register({
      id: 'artifact',
      label: 'Agent artifact',
      kind: 'remote',
      mode: 'replace',
      max: 1,
    })
    ctx.extensionPoints.register({
      id: 'composer-actions',
      label: 'Agent composer',
      kind: 'remote',
      mode: 'stack',
      max: 4,
    })
    ctx.extensionPoints.register({
      id: 'session-header',
      label: 'Agent session header',
      kind: 'remote',
      mode: 'stack',
      max: 2,
    })
    // A note on a request waiting for the person, such as a policy plugin's warning. Below the card's
    // own buttons, which stay the owner's (`AgentRequestCard`).
    ctx.extensionPoints.register({
      id: 'request-card',
      label: 'Agent request card',
      kind: 'remote',
      mode: 'stack',
      max: 2,
    })
    // The task row's agent state, in the rail's top-right corner. The host owns the corner and the
    // collision rules; this plugin only says what is true.
    ctx.railMarkers.register(agentRailMarkerContribution)
    ctx.sources.register(agentCenterSourceContribution)
    ctx.contextMenus.register({
      id: 'agents.sessions.mark-read',
      location: 'rail.source',
      surface: 'agents',
      label: 'Mark all agents read',
      icon: 'check',
      order: 110,
      when: () => clearableAgents().length > 0,
      run: () => {
        void markAgentsRead()
      },
    })
    // A terminal running one of this plugin's harness CLIs. The shell keeps the drawer toggle and the
    // plain shell, and knows no harness by name.
    for (const contribution of harnessTerminalCommands) ctx.commands.register(contribution)
    // Agent Center, and a search over this task's managed sessions.
    for (const contribution of agentsCommands) ctx.commands.register(contribution)
    // The two agent defaults the palette can change. A mounted component rather than a line here,
    // because both write through accessors that take a query client.
    ctx.slots.register(agentCommandsSlotContribution)
    // How a transcript's tool cards start out. This device's, so the slice is declared here and the key
    // is listed as device-owned in client-core's `DEVICE_KEYS`.
    ctx.persistedStateSlices.register(agentToolFoldSlice)
    ctx.persistedStateSlices.register(sessionOrderSlice)
    ctx.persistedStateSlices.register(composerExpansionSlice)
    // The Agents group's pages, each with the sections and rows it draws for search (each page's file
    // draws the same ones). Core's Tools and permissions (order 30) sits between them.
    ctx.settingsPages.register({
      id: 'agent-defaults',
      label: 'Harnesses and defaults',
      category: 'agents',
      scope: 'node',
      icon: 'sliders-horizontal',
      order: 10,
      requires: { plugin: 'agents' },
      // A section per installed harness is drawn as well, and left out because it depends on the node.
      keywords: [
        'harness',
        'claude code',
        'codex',
        'model',
        'effort',
        'reasoning',
        'usage limit',
        'fold',
        'collapse',
        'idle',
        'stuck',
        'retention',
      ],
      sections: [
        { id: 'harnesses', label: 'Harnesses', keywords: ['installed', 'cli'] },
        {
          id: 'accounts',
          label: 'Accounts',
          keywords: ['subscription', 'second account', 'work account', 'sign in', 'login'],
        },
        { id: 'usage', label: 'Usage limits', rows: ['Continue when usage resets'] },
        {
          id: 'idle',
          label: 'Idle agents',
          rows: ['Stop idle agents after', 'Stop idle agents above'],
          keywords: ['memory', 'stop'],
        },
        {
          id: 'repeated-calls',
          label: 'Stuck agents',
          rows: ['Warn when an agent repeats a tool call'],
          keywords: ['loop', 'repeat', 'stuck'],
        },
        {
          id: 'archived',
          label: 'Archived tasks',
          rows: ['Keep agent history for archived tasks'],
          keywords: ['retention', 'delete history', 'disk'],
        },
        {
          id: 'generate',
          label: 'Generating text',
          rows: ['Generate with'],
          keywords: ['default model', 'this device', 'commit message', 'sql generation', 'workflow drafts'],
        },
        // The switch's label reads "Send task context at startup", which a search for the words people
        // use for it would miss, so the section names them and search lands on the switch's section.
        {
          id: 'new-sessions',
          label: 'New sessions',
          rows: ["Carry my last session's settings forward", 'Send task context at startup', 'MCP servers'],
          keywords: ['startup context', 'task context'],
        },
        { id: 'inline', label: 'Inline diff chats', rows: ['Provider'] },
        {
          id: 'spawned',
          label: 'Spawned agents',
          rows: ['Spawn settings', 'Spawned agent harness'],
          keywords: ['subtasks', 'subagents', 'inherit', 'model', 'effort', 'reasoning'],
        },
        { id: 'transcript', label: 'Transcript', rows: ['Tool call display'], keywords: ['tool output'] },
      ],
      component: AgentSessionDefaultsSettings,
    })
    // Saved starts for a session: a harness, its options, instructions and tool access
    // (docs/managed-agents/custom-agents.md § Custom agents). "From plugins" is left out: it is only
    // drawn while a plugin contributes an agent.
    ctx.settingsPages.register({
      id: 'custom-agents',
      label: 'Custom agents',
      category: 'agents',
      scope: 'node',
      icon: 'bot',
      order: 20,
      requires: { plugin: 'agents' },
      keywords: ['instructions', 'system prompt', 'harness', 'preset'],
      sections: [{ id: 'agents', label: 'Your agents' }],
      component: CustomAgentsSettings,
    })
    // Two sections: the servers acorn adds to every session, and the ones each CLI loads by itself.
    // `mcp` is an alias for the config files section, so a link to that page id lands there.
    // Mixed-version path until 2027-01-07.
    ctx.settingsPages.register({
      id: 'agent-mcp-servers',
      label: 'MCP',
      category: 'agents',
      scope: 'node',
      icon: 'server-cog',
      order: 40,
      requires: { plugin: 'agents' },
      aliases: ['mcp#files'],
      keywords: [
        'mcp',
        'model context protocol',
        'tools',
        'stdio',
        'http',
        '/mcp',
        '.mcp.json',
        'claude.json',
        'cursor',
      ],
      sections: [
        { id: 'servers', label: 'Servers' },
        { id: 'files', label: 'Config files', rows: ['Project', 'Starter file'] },
      ],
      component: McpSettingsPage,
    })
    // This plugin's numbers on core's Settings > Storage and memory page: running agents, their
    // memory, and the stop for idle ones.
    ctx.extensions.register({
      id: 'agents.storage',
      point: CORE_STORAGE_POINT,
      label: 'Running agents',
      order: 10,
      requires: { plugin: 'agents' },
      component: AgentStorageSection,
    })
    // The instruction file check's switch, on core's Settings > Security and backup page.
    ctx.extensions.register({
      id: 'agents.security',
      point: CORE_SECURITY_POINT,
      label: 'Agent instruction files',
      order: 10,
      requires: { plugin: 'agents' },
      component: AgentSecuritySection,
    })
    // Which harnesses a plugin's tool hooks reach, on that plugin's own page.
    ctx.extensions.register({
      id: 'agents.loop-coverage',
      point: CORE_PLUGIN_PAGE_POINT,
      label: 'Agents it reaches',
      order: 10,
      requires: { plugin: 'agents' },
      component: LoopCoverageSection,
    })
    // Concurrency and pricing. `agent-concurrency` and `agent-pricing` are aliases, so a link, a
    // remembered page or another plugin's `openSettings('agent-pricing')` lands on its section here.
    // Mixed-version path until 2026-12-29.
    // "Unpriced models" is left out: it is only drawn while recent usage names a model with no price.
    ctx.settingsPages.register({
      id: 'agent-limits',
      label: 'Limits and cost',
      category: 'agents',
      scope: 'node',
      icon: 'gauge',
      order: 60,
      requires: { plugin: 'agents' },
      aliases: ['agent-concurrency#limits', 'agent-pricing#claude'],
      keywords: [
        'concurrency',
        'parallel',
        'queue',
        'limit',
        'turns',
        'cost',
        'pricing',
        'price',
        'tokens',
        'usd',
        'estimate',
        'cache',
      ],
      sections: [
        { id: 'limits', label: 'Turns at once', rows: ['Turns at once per provider', 'Turns at once per scope'] },
        { id: 'claude', label: 'Claude prices', rows: ['Built-in models', 'Other models'], keywords: ['anthropic'] },
        { id: 'codex', label: 'Codex prices', rows: ['Built-in models', 'Other models'], keywords: ['openai'] },
      ],
      component: AgentLimitsSettings,
    })
    // Fleet home's "agents running" number. Addressed at an explicit node, never the ambient one,
    // because the card exists to show several nodes at once.
    ctx.nodeStats.register({
      id: 'agents.active',
      order: 10,
      label: ['agent running', 'agents running'],
      fetch: async (nodeId, signal) =>
        (await managedAgentApi.sessions({ archived: false }, { nodeId, signal })).sessions.filter(isActiveAgent).length,
    })
    // The attention inbox's most important source: an agent waiting on a permission or a question is
    // blocked until the owner answers. `attention: true` is a server-side filter the route already
    // supports, so this is one request per node rather than a full roster fetch and a client filter.
    ctx.attentionSources.register({
      id: 'agents.sessions',
      order: 10,
      fetch: async (nodeId, signal) => {
        const page = await managedAgentApi.sessions({ attention: true, archived: false }, { nodeId, signal })
        return page.sessions.filter(needsAttention).map((session) => {
          const copy = ATTENTION_COPY[session.attention] ?? { title: 'needs attention', severity: 'warn' as const }
          return {
            // Not the bare session id: the row's identity is (this source, this session), and two
            // sources colliding on a session id would make one of them un-renderable.
            id: agentAttentionItemId(session.id),
            taskId: session.taskId,
            title: `${session.title || session.providerId} ${copy.title}`,
            detail: session.runtimeState,
            // `completed` is the one `info` in the table, and info is what the inbox lets the owner
            // retire by looking at it; every other attention names a block only they can lift.
            severity: copy.severity,
            // `updatedAt`, not now(): the row shows how long this has been waiting, which is the number
            // that decides whether the owner should care.
            at: session.updatedAt,
            target: { kind: 'managed-agent', resourceId: session.id },
          }
        })
      },
    })
  },
  // Not registration: these attach listeners to the managed-session store and return nothing the
  // registries can hold. `activateManagedAgentNotifications` also opens the app-lifetime agent
  // WebSocket subscription and primes the store over HTTP, which is why the whole set is in `activate`
  // rather than `init`. Each hands back its own undo, and the host runs them together if it ever takes
  // this plugin back, so a second activation replaces the first rather than stacking on it.
  activate: () => {
    const stops = [
      installManagedHandoff(async (sessionId) => {
        managedAgentStore.upsertSession(await managedAgentApi.resumeManaged(sessionId))
      }),
      activateManagedAgentNotifications(),
      activateManagedAgentNoticeTargets(),
      activateManagedAgentPaneIntents(),
    ]
    return () => {
      for (const stop of stops.reverse()) stop()
    }
  },
}
