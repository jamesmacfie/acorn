// How a run and its nodes read: the glyph per status, the tone, and elapsed as words.
//
// Shared by the list and the detail so the two cannot disagree about what "running" looks like.
// Each map is one line, because the icon census reads a line for a literal only when that line
// mentions an icon (client-core scripts/icon-census.mjs).
import type { WorkflowStepRow } from '@acorn/protocol/workflow.ts'
import type { WorkflowUsageSummary } from '../../shared/api'
import { BUILTIN_STEP_DESCRIPTIONS } from '../../shared/stepFields'

type Tone = 'ok' | 'warn' | 'danger' | 'muted'

const STEP_GLYPH: Record<string, string> = { pending: 'circle-dashed', running: 'loader-circle', 'waiting-gate': 'hand', done: 'circle-check', failed: 'circle-x', 'safety-rail': 'octagon-alert', skipped: 'circle-dashed', cancelled: 'ban' }
const STEP_TONE: Record<string, Tone> = { running: 'ok', 'waiting-gate': 'warn', done: 'ok', failed: 'danger', 'safety-rail': 'danger' }
const RUN_GLYPH: Record<string, string> = { running: 'loader-circle', gated: 'hand', cancelling: 'ban', done: 'circle-check', failed: 'circle-x', 'safety-rail': 'octagon-alert', cancelled: 'ban' }

export const stepGlyph = (status: string | undefined): string => STEP_GLYPH[status ?? 'pending'] ?? 'circle-dashed'
export const stepTone = (status: string | undefined): Tone => STEP_TONE[status ?? 'pending'] ?? 'muted'
export const runGlyph = (status: string): string => RUN_GLYPH[status] ?? 'circle-dashed'
export const runTone = (status: string): Tone => STEP_TONE[status] ?? (status === 'gated' ? 'warn' : 'muted')

export const kindLabel = (kind: string): string => BUILTIN_STEP_DESCRIPTIONS[kind]?.label ?? kind
export const kindRunsAgent = (kind: string): boolean => BUILTIN_STEP_DESCRIPTIONS[kind]?.runsAgent ?? false

/** "48s", "1m12s", "2h04m". Short enough for a list column and exact enough to compare two nodes. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

/** How long this node has taken. A running node counts from `now`, which the model ticks; a finished
 *  one is two stored timestamps and never moves again. */
export function stepElapsed(step: WorkflowStepRow | undefined, now: number): string {
  if (!step || step.status === 'pending' || step.status === 'skipped') return ''
  const end = step.status === 'running' || step.status === 'waiting-gate' ? now : step.updatedAt
  return formatDuration(end - step.createdAt)
}

export const runCost = (steps: readonly WorkflowStepRow[]): number =>
  steps.reduce((total, step) => total + (step.costUsd ?? 0), 0)

export const formatCost = (usd: number): string => (usd > 0 ? `$${usd.toFixed(2)}` : '')

/** A compact provider-usage line for the run footer and child cards. */
export const formatUsage = (usage: WorkflowUsageSummary | null | undefined): string => {
  if (!usage) return ''
  return [
    formatCost(usage.costUsd),
    `${usage.turns.toLocaleString()} ${usage.turns === 1 ? 'turn' : 'turns'}`,
    `${usage.inputTokens.toLocaleString()} input`,
    `${usage.outputTokens.toLocaleString()} output`,
  ].filter(Boolean).join(' · ')
}
