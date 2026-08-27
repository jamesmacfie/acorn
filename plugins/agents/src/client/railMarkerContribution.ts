// The task's agent state, on its rail row. One marker in the top-right corner: a turning loader while
// any agent in the task is moving, replaced by the alert glyph the moment one of them needs the owner.
//
// Both kinds of agent count. A managed session is this plugin's own (managedStore.ts); a terminal
// agent session is a CLI harness running in the task's worktree, which core holds because several
// surfaces read it but whose meaning — "an agent is working" — is this plugin's to say. Before this,
// core drew the loader from terminal sessions only, under the task glyph, and a managed agent working
// away in the background left the row looking idle.
import { agentSessionsFor, type RailMarker, type RailMarkerContribution } from '@acorn/plugin-api/client'
import type { AgentSession } from '@acorn/protocol/managedAgents.ts'
import { isActiveAgent, needsAttention } from './agentActivity'
import { managedAgentStore } from './managedStore'
import { runtimeIcon } from './stateTone'

export type AgentRailState = { working: number; attention: number }

/** The marker for one task's agent state, or nothing to say. Pure; the contribution below resolves
 *  the two stores. Attention wins outright rather than taking a second corner: one row, one answer to
 *  "what is this task's agent doing", and "it needs you" is the answer that matters. */
export function agentRailMarkers({ working, attention }: AgentRailState): RailMarker[] {
  if (attention)
    return [{
      id: 'attention',
      label: `${attention} agent${attention > 1 ? 's' : ''} need${attention > 1 ? '' : 's'} you`,
      // The same shape the pane header, the task sidebar and Agent Center give these two states
      // (stateTone.ts), so a reader learns one vocabulary.
      icon: runtimeIcon('waiting'),
      tone: 'warn',
      placements: ['top-end'],
    }]
  if (working)
    return [{
      id: 'working',
      label: `${working} agent${working > 1 ? 's' : ''} working`,
      icon: runtimeIcon('working'),
      tone: 'accent',
      busy: true,
      placements: ['top-end'],
    }]
  return []
}

const forTask = (taskId: string, predicate: (session: AgentSession) => boolean) =>
  managedAgentStore.sessions().filter((session) => session.taskId === taskId && predicate(session)).length

export const agentRailMarkerContribution: RailMarkerContribution = {
  id: 'agents',
  order: 10,
  markers: (target) => {
    if (target.kind !== 'task') return []
    return agentRailMarkers({
      // `idle` means the harness has gone quiet, which is the PTY tier's nearest thing to "not
      // working" (docs/terminal-and-agents.md).
      working: agentSessionsFor(target.id).filter((session) => !session.idle).length
        + forTask(target.id, isActiveAgent),
      attention: forTask(target.id, needsAttention),
    })
  },
}
