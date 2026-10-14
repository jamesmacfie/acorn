// How a run and its steps read in the run pane. The status glyphs, tones, words, and elapsed times
// are in plugins/workflows/src/contract/statusDisplay.ts, which the browser extension draws from too.
// This adds what only the desktop shows: step kinds, progress lines, and usage.
import type { WorkflowStepRow } from '../../contract/wire.ts'
import type { WorkflowUsageSummary } from '../../shared/api'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'
import { readPolicyWait } from '../../shared/policyWait'

export {
  formatDuration,
  runGlyph,
  runTone,
  statusLabel,
  stepElapsed,
  stepGlyph,
  stepTone,
} from '../../contract/statusDisplay.ts'

export const kindLabel = (kind: string): string => BUILTIN_STEP_DESCRIPTIONS[kind]?.label ?? kind
export const kindRunsAgent = (kind: string): boolean => BUILTIN_STEP_DESCRIPTIONS[kind]?.runsAgent ?? false

/** The one line under a running step: its latest `progress` event, and for a polling gate the wait it
 *  saved on its row, so a reload or a second client shows when it asks next without waiting for it. */
export function stepProgressLine(step: WorkflowStepRow, events: readonly unknown[]): string | undefined {
  if (step.status !== 'running') return undefined
  const latest = [...events]
    .reverse()
    .find((event): event is { type: 'progress'; text: string } => (event as { type?: unknown })?.type === 'progress')
  const wait = readPolicyWait(step.inputsJson)
  if (!wait) return latest?.text
  const detail = latest?.text ?? wait.detail ?? 'Not yet'
  const next =
    wait.state === 'sleeping' && wait.nextPollAt
      ? `next check at ${new Date(wait.nextPollAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
      : 'checking now'
  return `Waiting: ${detail} ${wait.polls} ${wait.polls === 1 ? 'check' : 'checks'} so far, ${next}.`
}

export const formatCost = (usd: number): string => (usd > 0 ? `$${usd.toFixed(2)}` : '')

/** A compact provider-usage line for the run footer and child cards. */
export const formatUsage = (usage: WorkflowUsageSummary | null | undefined): string => {
  if (!usage) return ''
  return [
    formatCost(usage.costUsd),
    `${usage.turns.toLocaleString()} ${usage.turns === 1 ? 'turn' : 'turns'}`,
    `${usage.inputTokens.toLocaleString()} tokens in, ${usage.outputTokens.toLocaleString()} out`,
  ]
    .filter(Boolean)
    .join(' · ')
}
