import { parseRailItemId, railItemId, type PluginRailItem } from '@acorn/protocol/api.ts'
import type { SentryIssueSummary } from './api'

export type SentryRailTarget = Pick<SentryIssueSummary, 'connectionId' | 'id'>

export function parseSentryRailItemId(value: string): SentryRailTarget | null {
  const parts = parseRailItemId(value)
  return parts && { connectionId: parts[0], id: parts[1] }
}

const severity = (level: string): Pick<PluginRailItem, 'icon' | 'severity'> => {
  if (level === 'fatal' || level === 'error') return { icon: 'circle-x', severity: 'danger' }
  if (level === 'warning') return { icon: 'triangle-alert', severity: 'warn' }
  return { icon: 'info', severity: 'info' }
}

// Level, title, and event count, as Rollbar's row spends its width. A collapsed row shows the short id.
export const sentryRailItem = (issue: SentryIssueSummary): PluginRailItem => ({
  id: railItemId(issue.connectionId, issue.id),
  title: issue.title,
  fields: [issue.count.toLocaleString()],
  short: issue.shortId,
  ...severity(issue.level),
})
