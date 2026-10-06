import { activeNodeId, markAttentionSeen, markTargetsRead, toast } from '@acorn/plugin-api/client'
import { hasClearableAttention } from './agentActivity'
import { managedAgentApi } from './managedClient'
import { agentAttentionItemId } from './managedSelection'
import { managedAgentStore } from './managedStore'

// "Mark all agents read", offered by the palette and the Agents rail icon's right-click menu
// (../commands.ts, ../index.ts). Both show it only while `clearableAgents()` has something in it.

/** Every session on the node whose finished or failed turn nobody has looked at yet. */
export const clearableAgents = () => managedAgentStore.sessions().filter(hasClearableAttention)

/**
 * Do what opening each session would: retire its "Needs you" row, mark its notices read, and move its
 * read mark to the end, which is what clears `attention` on the node (agentPaneModel.ts § Mark read).
 */
export async function markAgentsRead(): Promise<void> {
  const sessions = clearableAgents()
  if (!sessions.length) return
  const nodeId = activeNodeId() ?? ''
  for (const session of sessions) markAttentionSeen(nodeId, agentAttentionItemId(session.id))
  markTargetsRead('managed-agent', new Set(sessions.map((session) => session.id)))
  // ponytail: one request per session; a bulk route if somebody clears hundreds at once.
  const results = await Promise.allSettled(
    sessions.map((session) => managedAgentApi.patch(session.id, { lastReadSeq: managedAgentStore.lastEventSeq(session) })),
  )
  let failed = 0
  for (const result of results) {
    if (result.status === 'fulfilled') managedAgentStore.upsertSession(result.value)
    else failed++
  }
  if (failed) toast(`Could not mark ${failed} agent${failed > 1 ? 's' : ''} read`)
}
