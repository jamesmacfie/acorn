import type { Task } from '@acorn/protocol/api.ts'
import type { RollbarItemMetadata, RollbarOccurrenceDetail } from '../shared/api'
import type { RollbarRailTarget } from '../shared/rail'

export const taskRollbarTargets = (task: Task | undefined): RollbarRailTarget[] =>
  (task?.links ?? []).flatMap((link) => link.providerId === 'rollbar'
    ? [{ integrationId: link.connectionId, identifier: link.identifier }]
    : [])

export const targetKey = (target: RollbarRailTarget): string =>
  `${target.integrationId}\u0000${target.identifier}`

export function relativeTime(at: number | null, now = Date.now()): string {
  if (!at) return 'Not reported'
  const seconds = Math.max(0, Math.round((now - at) / 1_000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3_600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.round(seconds / 3_600)}h ago`
  return `${Math.round(seconds / 86_400)}d ago`
}

export function occurrenceContext(item: RollbarItemMetadata, occurrence: RollbarOccurrenceDetail): string {
  const lines = [`Rollbar #${item.identifier} [${item.level}] ${item.title}`, '']
  if (occurrence.exceptionClass || occurrence.message) {
    lines.push([occurrence.exceptionClass, occurrence.message].filter(Boolean).join(': '))
  }
  for (const frame of occurrence.frames.filter((candidate) => candidate.inProject !== false).slice(0, 15)) {
    lines.push(`  at ${frame.filename}${frame.line == null ? '' : `:${frame.line}`}${frame.method ? ` (${frame.method})` : ''}`)
  }
  const facts = [
    occurrence.environment && `environment: ${occurrence.environment}`,
    occurrence.codeVersion && `version: ${occurrence.codeVersion}`,
    occurrence.request?.url && `request: ${[occurrence.request.method, occurrence.request.url].filter(Boolean).join(' ')}`,
    occurrence.context && `context: ${occurrence.context}`,
    `occurrences: ${item.totalOccurrences}`,
    item.url && `link: ${item.url}`,
  ].filter((value): value is string => Boolean(value))
  if (facts.length) lines.push('', ...facts)
  return lines.join('\n')
}

// Status is a toned badge with a word (docs/ui-design/states.md § States): a map per field, not a regex over
// whatever string arrived. An unknown value keeps its own word, capitalised, and stays neutral.
type Tone = 'neutral' | 'ok' | 'warn' | 'danger'
const LEVELS: Record<string, [string, Tone]> = {
  critical: ['Critical', 'danger'], error: ['Error', 'danger'], warning: ['Warning', 'warn'], info: ['Info', 'neutral'], debug: ['Debug', 'neutral'],
}
const STATUSES: Record<string, [string, Tone]> = { active: ['Active', 'neutral'], resolved: ['Resolved', 'ok'], muted: ['Muted', 'neutral'] }
const word = (table: Record<string, [string, Tone]>, value: string): { label: string; tone: Tone } => {
  const [label, tone] = table[value.toLowerCase()] ?? [value.charAt(0).toUpperCase() + value.slice(1), 'neutral']
  return { label, tone }
}
export const levelWord = (level: string) => word(LEVELS, level)
export const statusWord = (status: string) => word(STATUSES, status)

// What to tell a person when a route fails. The routes answer with a code and no prose
// (server/routes/rollbar.ts), and this pane used to print the code.
const REASONS: Record<string, string> = {
  provider_needs_auth: "Rollbar turned down acorn's token. Reconnect Rollbar in Settings.",
  provider_rate_limited: 'Rollbar is limiting requests. Try again in a minute.',
  provider_unavailable: "Rollbar didn't answer. Try again.",
  provider_not_connected: "Rollbar isn't connected.",
  provider_resource_not_found: "Rollbar can't find this error.",
}

/** A failed bridge call as one plain sentence. A message that is more than its own code is kept. */
export function failureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code
  if (typeof code === 'string' && REASONS[code]) return REASONS[code]
  const message = error instanceof Error ? error.message : ''
  return message && message !== code && !/^[a-z_]+$/.test(message) ? message : 'Something went wrong. Try again.'
}
