// How a run and its steps read: the glyph per status, the tone, the word, and elapsed as words. The
// desktop's run pane and the browser extension's Workflows view both draw from here, so the two can't
// disagree about what "running" looks like. Each map is one line, because the icon census reads a line
// for a literal only when that line mentions an icon (client-core scripts/icon-census.mjs).

type Tone = 'ok' | 'warn' | 'danger' | 'muted'

const STEP_GLYPH: Record<string, string> = {
  pending: 'circle-dashed',
  running: 'loader-circle',
  'waiting-gate': 'hand',
  done: 'circle-check',
  'completed-with-failures': 'circle-alert',
  failed: 'circle-x',
  'safety-rail': 'octagon-alert',
  skipped: 'circle-dashed',
  cancelled: 'ban',
}
const STEP_TONE: Record<string, Tone> = {
  running: 'ok',
  'waiting-gate': 'warn',
  done: 'ok',
  'completed-with-failures': 'warn',
  failed: 'danger',
  'safety-rail': 'danger',
}
// `waiting` is the merged run list's word for `gated` (@acorn/protocol/runs.ts), which the rail reads.
const RUN_GLYPH: Record<string, string> = {
  running: 'loader-circle',
  gated: 'hand',
  waiting: 'hand',
  cancelling: 'ban',
  done: 'circle-check',
  'completed-with-failures': 'circle-alert',
  failed: 'circle-x',
  'safety-rail': 'octagon-alert',
  cancelled: 'ban',
}
// One map for step and run statuses, because where the two vocabularies share a word they mean the same thing.
const STATUS_LABEL: Record<string, string> = {
  pending: 'Not started',
  running: 'Running',
  'waiting-gate': 'Needs you',
  gated: 'Needs you',
  waiting: 'Needs you',
  'waiting-children': 'Waiting',
  cancelling: 'Cancelling',
  done: 'Done',
  'completed-with-failures': 'Finished with failures',
  failed: 'Failed',
  skipped: 'Skipped',
  'safety-rail': 'Stopped at a limit',
  cancelled: 'Cancelled',
  // A child run's dispatch, before the run itself has a status.
  reserved: 'Starting',
  'task-created': 'Starting',
  'run-started': 'Starting',
  terminal: 'Finished',
}

export const stepGlyph = (status: string | undefined): string => STEP_GLYPH[status ?? 'pending'] ?? 'circle-dashed'
export const stepTone = (status: string | undefined): Tone => STEP_TONE[status ?? 'pending'] ?? 'muted'
export const runGlyph = (status: string): string => RUN_GLYPH[status] ?? 'circle-dashed'
export const runTone = (status: string): Tone =>
  STEP_TONE[status] ?? (status === 'gated' || status === 'waiting' ? 'warn' : 'muted')
// A run whose status and steps still change without anyone asking.
const LIVE_RUN = new Set(['running', 'gated', 'cancelling'])
export const runIsLive = (status: string): boolean => LIVE_RUN.has(status)

/** The word a person reads for a step or run status: "Needs you", not `waiting-gate`. */
export const statusLabel = (status: string | undefined): string =>
  STATUS_LABEL[status ?? 'pending'] ?? status ?? 'Not started'

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
export function stepElapsed(
  step: { status: string; createdAt: number; updatedAt: number } | undefined,
  now: number,
): string {
  if (!step || step.status === 'pending' || step.status === 'skipped') return ''
  const end = step.status === 'running' || step.status === 'waiting-gate' ? now : step.updatedAt
  return formatDuration(end - step.createdAt)
}
