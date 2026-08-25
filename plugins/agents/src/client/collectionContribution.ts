// Managed agent sessions as a dashboard collection (docs/dashboards.md § Collections).
//
// The third reader of the list route the Fleet stat and the attention inbox already read (index.ts),
// this one taking the whole roster with a schema on it. No new endpoint and no new wire format:
// `/sessions?archived=false` answers it, and the panel's own filters do the narrowing.
import type { AgentAttentionReason, AgentRuntimeState, AgentSession } from '@acorn/protocol/managedAgents.ts'
import type {
  PluginCollectionEnumValue,
  PluginCollectionPage,
  PluginCollectionRow,
  PluginCollectionSchema,
} from '@acorn/protocol/collections.ts'
import { sessionModelLabel } from './agentConfigOptions'
import { managedAgentApi } from './managedClient'
import { AGENT_PANE_ID } from './paneContribution'
import { runtimeIcon, runtimeTone } from './stateTone'

export const SESSIONS_COLLECTION_ID = 'sessions'

// A Record over the union rather than an array, so the day a runtime state is added the build says so
// here instead of the panel rendering a raw id nobody toned. Same for attention below.
const STATE_LABELS: Record<AgentRuntimeState, string> = {
  creating: 'Creating',
  connecting: 'Connecting',
  replaying: 'Replaying',
  ready: 'Ready',
  working: 'Working',
  waiting: 'Waiting',
  cancelling: 'Cancelling',
  reconnecting: 'Reconnecting',
  stopped: 'Stopped',
  failed: 'Failed',
  archived: 'Archived',
}

const ATTENTION_LABELS: Record<AgentAttentionReason, string> = {
  permission: 'Wants permission',
  question: 'Asked a question',
  workflow_gate: 'At a workflow gate',
  completed: 'Finished a turn',
  error: 'Failed',
  unread: 'Unread',
  none: 'Nothing',
}

// Icon and tone both come from the pair in stateTone.ts, so a panel row and a sidebar row draw the
// same state the same way.
const stateValues: PluginCollectionEnumValue[] = Object.entries(STATE_LABELS)
  .map(([id, label]) => ({ id, label, tone: runtimeTone(id), icon: runtimeIcon(id) }))

// Only the reasons that block the owner get a warning tone. `completed` is a nudge and the rest are
// quiet, the same split ATTENTION_COPY makes for the inbox.
const attentionValues: PluginCollectionEnumValue[] = Object.entries(ATTENTION_LABELS).map(([id, label]) => ({
  id,
  label,
  tone: id === 'permission' || id === 'question' || id === 'workflow_gate'
    ? 'warn'
    : id === 'error' ? 'bad' : id === 'completed' ? 'accent' : 'muted',
}))

// Static: the columns are the session row's own shape, so a panel editor can offer views before any
// node has answered.
const sessionsSchema = {
  fields: [
    { id: 'title', name: 'Title', type: 'text', role: 'title' },
    { id: 'state', name: 'State', type: 'enum', role: 'status', values: stateValues },
    { id: 'attention', name: 'Attention', type: 'enum', values: attentionValues },
    { id: 'provider', name: 'Provider', type: 'text' },
    { id: 'model', name: 'Model', type: 'text' },
    { id: 'updated', name: 'Updated', type: 'datetime', role: 'updated' },
  ],
} satisfies PluginCollectionSchema

// Exported for the drift check in the test beside this. A field id renamed on one side and not the
// other renders empty cells and throws nowhere.
//
// The click opens the agent in its own task. A session belongs to a task and a dashboard is drawn
// outside every task, so `openPane` alone would open the Agent pane of whichever task is on screen.
// The host activates the named task, navigates to it, and hands the row's id to the pane as its
// selection, which `paneIntentSelection` below turns into "this session".
export const sessionRow = (session: AgentSession): PluginCollectionRow => ({
  id: session.id,
  pluginId: 'agents',
  collectionId: SESSIONS_COLLECTION_ID,
  taskId: session.taskId,
  action: { verb: 'openPane', pane: AGENT_PANE_ID },
  values: {
    title: session.title || session.providerId,
    state: session.runtimeState,
    attention: session.attention,
    provider: session.providerId,
    model: sessionModelLabel(session) ?? null,
    updated: session.updatedAt,
  },
})

export const agentSessionsCollection = {
  collectionId: SESSIONS_COLLECTION_ID,
  name: 'Agent sessions',
  schema: sessionsSchema,
  // A session runs in a task, a task belongs to a workspace, and a board belongs to one workspace, so
  // the fleet on it is that workspace's. The host fills the `workspace` param from the board rather
  // than the panel naming one, because one definition is placed on a board in every workspace
  // (client-core/dashboards/data.ts, `scopedQuery`).
  workspaceScoped: true,
  // Sessions move on the WebSocket, but a panel is a glance surface and nothing here subscribes; half a
  // minute is the same order as the Fleet stat's own freshness.
  refresh: 30,
  // `workspace` is the host's, filled from the board (`workspaceScoped` above). Absent is every session
  // on the node, which is what a surface with no workspace behind it means.
  fetch: async (nodeId: string, params: Record<string, string>, signal: AbortSignal): Promise<PluginCollectionPage> => {
    const page = await managedAgentApi.sessions(
      { archived: false, ...(params.workspace ? { workspaceId: params.workspace } : {}) },
      { nodeId, signal },
    )
    return { schema: sessionsSchema, rows: page.sessions.map(sessionRow) }
  },
}
