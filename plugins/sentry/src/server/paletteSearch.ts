import { MAX_COMMAND_SEARCH_ITEMS, type CommandSearchItem } from '@acorn/protocol/commands.ts'
import { railItemId } from '@acorn/protocol/api.ts'
import type { SentryIssueSummary } from '../shared/api'

// Ranking the palette's Sentry rows, as a pure function over the list the rail reads. Rollbar's
// ranking, spelled for Sentry's fields: an exact short id beats a title, a title beats the facts
// around it, and equal matches keep Sentry's newest-first order (docs/integrations/sentry.md § Palette
// search).

// The bounds the host holds a row to. Trimmed here, because the host drops an oversized row outright.
const TITLE = 300
const SUBTITLE = 300
const BADGE = 80

/** How well one issue answers `query`, higher first, or `null` when it doesn't answer it at all. */
export function sentrySearchScore(issue: SentryIssueSummary, query: string): number | null {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const shortId = issue.shortId.toLowerCase()
  if (shortId === needle) return 4
  const title = issue.title.toLowerCase()
  if (title.startsWith(needle)) return 3
  if (title.includes(needle)) return 2
  if (shortId.includes(needle) || issue.culprit?.toLowerCase().includes(needle) || issue.level === needle) return 1
  return null
}

// The id is the rail's `<connection>:<issue id>`, the one `navigate` puts in the URL.
const sentrySearchItem = (issue: SentryIssueSummary): CommandSearchItem => ({
  id: railItemId(issue.connectionId, issue.id),
  title: issue.title.slice(0, TITLE),
  subtitle: [issue.shortId, issue.level, issue.culprit, issue.connectionLabel]
    .filter(Boolean)
    .join(' · ')
    .slice(0, SUBTITLE),
  badge: `${issue.count.toLocaleString()} event${issue.count === 1 ? '' : 's'}`.slice(0, BADGE),
  ref: issue.shortId,
})

/** The matching rows, best first, capped at what the host renders. */
export function sentrySearchItems(issues: readonly SentryIssueSummary[], query: string): CommandSearchItem[] {
  return issues
    .map((issue, at) => ({ issue, at, score: sentrySearchScore(issue, query) }))
    .filter((row): row is { issue: SentryIssueSummary; at: number; score: number } => row.score !== null)
    .sort((a, b) => b.score - a.score || a.at - b.at)
    .slice(0, MAX_COMMAND_SEARCH_ITEMS)
    .map((row) => sentrySearchItem(row.issue))
}
