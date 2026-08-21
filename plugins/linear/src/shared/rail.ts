import { parseRailItemId, railItemId, type PluginRailItem } from '@acorn/protocol/api.ts'
import type { LinearProjectIssue } from './api'
import { priorityMeta } from './triage'

// The encoding is the host's (protocol/api.ts § railItemId); these two name its halves for Linear. The
// connection has to travel with the identifier because Linear issue keys are not globally unique
// across connections (docs/integrations.md § Linear).
export type LinearRailTarget = { connectionId: string; identifier: string }

export const linearRailItemId = (target: LinearRailTarget): string =>
  railItemId(target.connectionId, target.identifier)

export function parseLinearRailItemId(value: string): LinearRailTarget | null {
  const parts = parseRailItemId(value)
  return parts && { connectionId: parts[0], identifier: parts[1] }
}

// One rail row, including the promotion seed the host acts on when the row's +Task is used.
//
// The `task` block asks less than rollbar's, because Linear differs, not the mechanism: an issue
// carries `branchName`, Linear's own suggestion, so the row can name the branch and the host's modal
// has nothing left to demand. `origin: 'linear'` is the pre-loader origin these tasks have always
// carried and stays that way, since `ownsTaskOrigin` accepts the exact plugin id and changing it would
// split one provider's task history in two.
//
// Byte-for-byte the seed `client/promotion.ts` produced, down to the branch fallback, so a task
// promoted from the loaded rail is indistinguishable from one promoted before the move.
export function linearRailItem(issue: LinearProjectIssue): PluginRailItem {
  // Positional, and never filtered: `fields` is laid out as columns, so an issue with no assignee
  // has to keep the empty cell or its priority slides under the next row's assignee.
  const facts = [
    issue.identifier,
    issue.state?.name ?? '',
    issue.assignee ?? '',
    priorityMeta(issue.priority, issue.priorityLabel).label,
  ]
  return {
    id: linearRailItemId({ connectionId: issue.integrationId, identifier: issue.identifier }),
    title: issue.title,
    fields: facts,
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
