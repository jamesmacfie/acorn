// What a subagent row says about itself, in the transcript card and in the task sidebar.
//
// Each harness knows a different subset, so the line is whatever actually arrived rather than a fixed
// set of columns with gaps in it. Codex reports a child's status and the name it was spawned under and
// nothing else, ever; Claude reports the model, the tool-use count and the duration, but only in the
// summary that lands once the subagent is already done. Rendering a placeholder for the other
// harness's fields would show every Codex row as a row with two blanks in it.
//
// Its own module rather than a helper inside the card, so it can be tested: the plugin's tests run in
// node with no Solid plugin, so nothing exported from a `.tsx` is reachable from a test.
import type { AgentSubagentStatus, AgentSubagentUpdate } from '@acorn/protocol/managedAgents.ts'

/** A subagent's status as a word. */
export const subagentStatusLabel = (status: AgentSubagentStatus | undefined): string => {
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'idle') return 'Idle'
  if (status === 'pending') return 'Starting'
  return 'Working'
}

/**
 * `sessionModel` is the model of the session that spawned this subagent, which is what a child runs on
 * unless the spawn asked for another one. It only shows when the harness has not named the child's own
 * model: Codex never does, and Claude only does once the child has finished.
 *
 * ponytail: an inherited model is an assumption, not a report. Codex does carry a model on the
 * `collabAgentToolCall` item that spawns a child, so read that if a session ever runs children on a
 * model the parent is not on.
 */
export const subagentFacts = (subagent: AgentSubagentUpdate, sessionModel?: string): string[] => {
  const model = subagent.model ?? sessionModel
  return [
    subagentStatusLabel(subagent.status),
    // The role is dropped when it repeats the title. Codex names a subagent from its agent path, so both
    // read "alpha" and the line would say it twice.
    ...(subagent.role && subagent.role !== subagent.title ? [subagent.role] : []),
    ...(model ? [model] : []),
    ...(subagent.toolUseCount ? [`${subagent.toolUseCount} tool ${subagent.toolUseCount === 1 ? 'use' : 'uses'}`] : []),
    ...(subagent.durationMs != null ? [`${(subagent.durationMs / 1_000).toFixed(1)}s`] : []),
  ]
}

export const subagentSummary = (subagent: AgentSubagentUpdate, sessionModel?: string): string =>
  subagentFacts(subagent, sessionModel).join(' · ')
