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
  if (!at) return 'unknown'
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
