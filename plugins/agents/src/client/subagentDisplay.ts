// What a subagent row says about itself, in the transcript card and in the task sidebar.
//
// Each harness knows a different subset, so the line is whatever actually arrived rather than a fixed
// set of columns with gaps in it. Codex reports tokens live from the child thread's own
// `thread/tokenUsage/updated` and never names a model; Claude reports the model, the token total, the
// tool-use count and the duration, but only in the summary that lands when the subagent is already
// done. Rendering a placeholder for the other harness's fields would show every Codex row as a row
// with three blanks in it.
//
// Its own module rather than a helper inside the card, so it can be tested: the plugin's tests run in
// node with no Solid plugin, so nothing exported from a `.tsx` is reachable from a test.
import type { AgentSubagentStatus, AgentSubagentUpdate } from '@acorn/protocol/managedAgents.ts'

/** A subagent's status as a word. `idle` needs saying in full, or a reader takes it for stalled. */
export const subagentStatusLabel = (status: AgentSubagentStatus | undefined): string => {
  if (status === 'completed') return 'Completed'
  if (status === 'failed') return 'Failed'
  if (status === 'idle') return 'Idle, resumable'
  if (status === 'pending') return 'Starting'
  return 'Working'
}

export const subagentFacts = (subagent: AgentSubagentUpdate): string[] => [
  subagentStatusLabel(subagent.status),
  // The role is dropped when it repeats the title. Codex names a subagent from its agent path, so both
  // read "alpha" and the line would say it twice.
  ...(subagent.role && subagent.role !== subagent.title ? [subagent.role] : []),
  ...(subagent.model ? [subagent.model] : []),
  ...(subagent.usage?.contextUsed != null ? [`${subagent.usage.contextUsed.toLocaleString()} tok`] : []),
  ...(subagent.toolUseCount ? [`${subagent.toolUseCount} tool ${subagent.toolUseCount === 1 ? 'use' : 'uses'}`] : []),
  ...(subagent.durationMs != null ? [`${(subagent.durationMs / 1_000).toFixed(1)}s`] : []),
]

export const subagentSummary = (subagent: AgentSubagentUpdate): string => subagentFacts(subagent).join(' · ')
