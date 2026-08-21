import { parseRailItemId, railItemId, type PluginRailItem } from '@acorn/protocol/api.ts'
import type { RollbarItemSummary } from './api'

// The encoding is the host's (protocol/api.ts § railItemId); these two put Rollbar's names on its two
// halves, because `integrationId` is what every other Rollbar type calls a connection.
export type RollbarRailTarget = Pick<RollbarItemSummary, 'integrationId' | 'identifier'>

export const rollbarRailItemId = (target: RollbarRailTarget): string =>
  railItemId(target.integrationId, target.identifier)

export function parseRollbarRailItemId(value: string): RollbarRailTarget | null {
  const parts = parseRailItemId(value)
  return parts && { integrationId: parts[0], identifier: parts[1] }
}

export function rollbarRailItem(item: RollbarItemSummary): PluginRailItem {
  // Positional, and never filtered: see linear/shared/rail.ts. The host lays these out as columns,
  // and an empty cell is what keeps the Nth fact under the Nth fact of every other row.
  const facts = [
    `#${item.identifier}`,
    item.level,
    item.environment,
    item.integrationLabel,
  ]
  return {
    id: rollbarRailItemId(item),
    title: item.title,
    fields: facts,
    badge: `${item.totalOccurrences} occurrence${item.totalOccurrences === 1 ? '' : 's'}`,
    task: {
      origin: 'rollbar',
      title: item.title.slice(0, 120),
      link: {
        connectionId: item.integrationId,
        identifier: item.identifier,
        ref: {
          displayId: item.identifier,
          ...(item.itemId ? { externalId: item.itemId } : {}),
          ...(item.url ? { url: item.url } : {}),
        },
      },
    },
  }
}
