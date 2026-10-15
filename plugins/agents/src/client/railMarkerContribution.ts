// The task's agent state, on its rail row. One marker in the top-right corner: a turning loader while
// any agent in the task is moving, replaced by the alert glyph the moment one of them needs the owner.
//
// Both kinds of agent count. A managed session is this plugin's own; a terminal agent session is a CLI
// harness running in the task's worktree, which core holds because several surfaces read it but whose
// meaning, "an agent is working", is this plugin's to say.
import { agentSessionsFor, type RailMarkerContribution } from '@acorn/plugin-api/client'
import type { AgentSession } from '../contract/wire.ts'
import { isActiveAgent, needsAttention } from './sessions/agentActivity'
import { managedAgentStore } from './sessions/managedStore'
import { AGENT_PANE_ID } from './paneIdentity'
import { agentRailMarkers } from '../contract/runtimeState.ts'

// The task's own slice, not the roster: this runs for every row in the rail, and a slice only wakes the
// row whose task changed.
const forTask = (taskId: string, predicate: (session: AgentSession) => boolean) =>
  managedAgentStore.sessionsForTask(taskId).filter(predicate).length

// The workflows plugin's pane id, by value: a plugin cannot import another's modules. Its button gets a
// spinner only for this task's workflow agents, so a spinner on the Agent button with none here says
// the agent at work is not the workflow's.
const WORKFLOWS_PANE_ID = 'workflows'
// `waiting` counts as active, but the agent has stopped until the owner answers, so it doesn't turn a
// loader. The Workflows button shows no attention, so there a waiting agent would spin until answered.
const hasAgentWork = (session: AgentSession) =>
  (isActiveAgent(session) && session.runtimeState !== 'waiting') ||
  (!['stopped', 'failed', 'archived'].includes(session.runtimeState) &&
    session.subagents.some((child) => child.status === 'pending' || child.status === 'running'))
const isWorkingWorkflowAgent = (session: AgentSession) => session.kind === 'workflow' && hasAgentWork(session)

export const agentRailMarkerContribution: RailMarkerContribution = {
  id: 'agents',
  order: 10,
  markers: (target) => {
    if (target.kind === 'pane' && target.id === WORKFLOWS_PANE_ID)
      return agentRailMarkers({ working: forTask(target.taskId, isWorkingWorkflowAgent), attention: 0 })
    // The same answer on the task's rail row and on its Agent button in the pane rail, so the corner
    // that says "working" on the left says it on the right too.
    const taskId =
      target.kind === 'task' ? target.id : target.kind === 'pane' && target.id === AGENT_PANE_ID ? target.taskId : null
    if (!taskId) return []
    return agentRailMarkers({
      // `idle` means the harness has gone quiet, which is the PTY tier's nearest thing to "not
      // working" (docs/terminal/activity.md § Activity and status).
      working: agentSessionsFor(taskId).filter((session) => !session.idle).length + forTask(taskId, hasAgentWork),
      attention: forTask(taskId, needsAttention),
    })
  },
}
