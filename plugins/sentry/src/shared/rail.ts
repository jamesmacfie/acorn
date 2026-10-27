import { parseRailItemId, railItemId, type PluginRailItem } from '@acorn/protocol/api.ts'
import { ENV_CONNECTION_ID, type SentryIssueSummary } from './api'

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

// What a task made from an issue starts with: its title, and the issue as a link on its connection.
// The host's promotion draws the dialog and makes the task. `origin` must stay the plugin id, because
// `ownsTaskOrigin` matches it exactly. The body is what a workflow started from the row is told.
//
// An issue read through the environment offers no task. Core keeps a task link against a Settings
// connection's row, and the environment has none, nor any promise to name the same project after a
// restart (docs/integrations/sentry.md § Sentry issues in tasks).
const sentryTask = (issue: SentryIssueSummary): PluginRailItem['task'] =>
  issue.connectionId === ENV_CONNECTION_ID
    ? undefined
    : {
        origin: 'sentry',
        title: issue.title.slice(0, 120),
        link: {
          connectionId: issue.connectionId,
          identifier: issue.id,
          ref: { displayId: issue.id, ...(issue.url ? { url: issue.url } : {}) },
        },
        body: [
          `Sentry ${issue.shortId}`,
          `Level: ${issue.level}`,
          `Events: ${issue.count}`,
          ...(issue.culprit ? [`Culprit: ${issue.culprit}`] : []),
          ...(issue.url ? [issue.url] : []),
        ].join('\n'),
      }

// Level, title, and event count, as Rollbar's row spends its width. A collapsed row shows the short id.
export const sentryRailItem = (issue: SentryIssueSummary): PluginRailItem => {
  const task = sentryTask(issue)
  return {
    id: railItemId(issue.connectionId, issue.id),
    title: issue.title,
    fields: [issue.count.toLocaleString()],
    short: issue.shortId,
    ...severity(issue.level),
    ...(task ? { task } : {}),
  }
}
