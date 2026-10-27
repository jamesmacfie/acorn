import { activeNodeId, markAttentionSeen, markTargetsRead, toast, type AttentionItem } from '@acorn/plugin-api/client'
import type { AgentSession } from '../../contract/wire.ts'
import { hasClearableAttention } from './agentActivity'
import { managedAgentApi } from './managedClient'
import { agentAttentionItemId } from './managedSelection'
import { managedAgentStore } from './managedStore'

// "Mark all agents read", offered by the palette and the Agents rail icon's right-click menu. Both show it
// only while `clearableAgents()` has something in it.

/** Every session on the node whose finished or failed turn nobody has looked at yet. */
export const clearableAgents = () => managedAgentStore.sessions().filter(hasClearableAttention)

/**
 * Do what opening each session would: retire its "Needs you" row, mark its notices read, and move its
 * read mark to the end, which is what clears `attention` on the node (the pane model's mark read).
 */
export async function markAgentsRead(): Promise<void> {
  const sessions = clearableAgents()
  if (!sessions.length) return
  const nodeId = activeNodeId() ?? ''
  for (const session of sessions) markAttentionSeen(nodeId, agentAttentionItemId(session.id))
  markTargetsRead('managed-agent', new Set(sessions.map((session) => session.id)))
  const failed = await readToEnd(sessions)
  if (failed) toast(`Could not mark ${failed} agent${failed > 1 ? 's' : ''} read`)
}

/**
 * The bell's "Mark all read" for this plugin's rows, on any node. The bell has already hidden them;
 * this clears `attention` on the node so they don't return in the next window.
 *
 * The rows carry no read mark, so the node is asked for the sessions again. Only those still at
 * `completed` are read: one that has moved on to a permission or a question since the bell drew it is
 * a block, and the bell never clears a block.
 */
export async function acknowledgeAgentRows(nodeId: string, items: readonly AttentionItem[]): Promise<void> {
  const ids = new Set(items.map((item) => item.target.resourceId))
  const page = await managedAgentApi.sessions({ attention: true, archived: false }, { nodeId })
  const failed = await readToEnd(
    page.sessions.filter((session) => ids.has(session.id) && session.attention === 'completed'),
    nodeId,
  )
  if (failed) toast(`Could not mark ${failed} agent${failed > 1 ? 's' : ''} read`)
}

// One request per session; a bulk route if somebody clears hundreds at once. Answers how many failed.
// No node means the active one.
async function readToEnd(sessions: readonly AgentSession[], nodeId?: string): Promise<number> {
  // The store holds the active node's sessions and their live sequence numbers. Another node's session
  // is read to the end its own row reports.
  const local = nodeId === undefined || nodeId === activeNodeId()
  const results = await Promise.allSettled(
    sessions.map((session) =>
      managedAgentApi.patch(
        session.id,
        { lastReadSeq: local ? managedAgentStore.lastEventSeq(session) : session.lastEventSeq },
        nodeId === undefined ? {} : { nodeId },
      ),
    ),
  )
  let failed = 0
  for (const result of results) {
    if (result.status === 'rejected') failed++
    else if (local) managedAgentStore.upsertSession(result.value)
  }
  return failed
}
