import type { PluginRailItem } from '@acorn/protocol/api.ts'
import type { LinearProjectIssue } from './api'
import { priorityMeta } from './triage'

// A rail row's id has to survive the round trip: the host hands it back verbatim as the pane frame's
// `context.item`, and the frame has to recover BOTH halves of an issue's identity from it. Linear team
// keys make `ENG-42` look globally unique and it is not — two connected workspaces can share a prefix
// — so the connection travels with it. Percent-encoded around a single `:` for the same reason
// rollbar's is: either half may legitimately contain the delimiter.
export type LinearRailTarget = { connectionId: string; identifier: string }

export const linearRailItemId = (target: LinearRailTarget): string =>
  `${encodeURIComponent(target.connectionId)}:${encodeURIComponent(target.identifier)}`

export function parseLinearRailItemId(value: string): LinearRailTarget | null {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return null
  try {
    const connectionId = decodeURIComponent(value.slice(0, separator))
    const identifier = decodeURIComponent(value.slice(separator + 1))
    return connectionId && identifier ? { connectionId, identifier } : null
  } catch {
    return null
  }
}

// One rail row, including the promotion seed the host acts on when the row's +TASK is used.
//
// The `task` block asks LESS than rollbar's, and the reason is Linear rather than the mechanism: an
// issue carries `branchName`, Linear's own suggestion, so the row can name the branch and the host's
// modal has nothing left to demand. `origin: 'linear'` is the pre-loader origin these tasks have always
// carried and is preserved deliberately — the host allows it because `ownsTaskOrigin` accepts the exact
// plugin id, and changing it would split one provider's task history in two.
//
// Byte-for-byte the seed `client/promotion.ts` produced, down to the branch fallback, so a task promoted
// from the loaded rail is indistinguishable from one promoted before the move.
export function linearRailItem(issue: LinearProjectIssue): PluginRailItem {
  const facts = [
    issue.identifier,
    issue.state?.name,
    issue.assignee,
    priorityMeta(issue.priority, issue.priorityLabel).label,
  ].filter(Boolean)
  return {
    id: linearRailItemId({ connectionId: issue.integrationId, identifier: issue.identifier }),
    title: issue.title,
    subtitle: facts.join(' · '),
    ...(issue.labels.length ? { badge: issue.labels.map((label) => label.name).join(', ') } : {}),
    task: {
      origin: 'linear',
      title: `${issue.identifier} ${issue.title}`,
      branch: issue.branchName || issue.identifier.toLowerCase(),
      link: {
        connectionId: issue.integrationId,
        identifier: issue.identifier,
        ref: { displayId: issue.identifier, url: issue.url },
      },
    },
  }
}
