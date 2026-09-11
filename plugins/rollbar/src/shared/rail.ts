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

type RollbarSeverity = Pick<PluginRailItem, 'icon' | 'severity'>

const rollbarSeverity = (level: string): RollbarSeverity => {
  if (level === 'error' || level === 'critical') return { icon: 'circle-x', severity: 'danger' }
  if (level === 'warning' || level === 'warn') return { icon: 'triangle-alert', severity: 'warn' }
  return { icon: 'info', severity: 'info' }
}

export function rollbarRailItem(item: RollbarItemSummary): PluginRailItem {
  return {
    id: rollbarRailItemId(item),
    title: item.title,
    // One reserved track keeps short and long Rollbar ids aligned; the flexible title gets the rest.
    fields: [`#${item.identifier}`],
    fieldsFirst: true,
    ...rollbarSeverity(item.level),
    badge: String(item.totalOccurrences),
    task: {
      origin: 'rollbar',
      title: item.title.slice(0, 120),
      // What a workflow started from this row is told about it (docs/workflows.md § Starting a run).
      // Rollbar's list route carries no prose — an item's body is its stack trace, which is a second
      // call per row — so this is the facts the row already has, which is what an investigating agent
      // needs first anyway.
      body: [
        `Level: ${item.level}`,
        `Environment: ${item.environment}`,
        `Occurrences: ${item.totalOccurrences}`,
        ...(item.framework ? [`Framework: ${item.framework}`] : []),
        ...(item.url ? [item.url] : []),
      ].join('\n'),
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
