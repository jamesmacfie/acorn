import type { PluginRailItem } from '@acorn/protocol/api.ts'
import type { RollbarItemSummary } from './api'

export type RollbarRailTarget = Pick<RollbarItemSummary, 'integrationId' | 'identifier'>

export const rollbarRailItemId = (target: RollbarRailTarget): string =>
  `${encodeURIComponent(target.integrationId)}:${encodeURIComponent(target.identifier)}`

export function parseRollbarRailItemId(value: string): RollbarRailTarget | null {
  const separator = value.indexOf(':')
  if (separator <= 0 || separator === value.length - 1) return null
  try {
    const integrationId = decodeURIComponent(value.slice(0, separator))
    const identifier = decodeURIComponent(value.slice(separator + 1))
    return integrationId && identifier ? { integrationId, identifier } : null
  } catch {
    return null
  }
}

export function rollbarRailItem(item: RollbarItemSummary): PluginRailItem {
  const facts = [
    `#${item.identifier}`,
    item.level,
    item.environment,
    item.integrationLabel,
  ].filter(Boolean)
  return {
    id: rollbarRailItemId(item),
    title: item.title,
    subtitle: facts.join(' · '),
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
