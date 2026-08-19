import { describe, expect, it } from 'vitest'
import type { RollbarItemSummary } from './api'
import { parseRollbarRailItemId, rollbarRailItem, rollbarRailItemId } from './rail'

const ITEM: RollbarItemSummary = {
  integrationId: 'rollbar:production',
  integrationLabel: 'Production',
  identifier: '142/7',
  itemId: '999',
  url: 'https://rollbar.com/item/999/',
  title: 'Checkout failed',
  level: 'error',
  environment: 'production',
  status: 'active',
  totalOccurrences: 12,
  firstOccurrenceAt: 1,
  lastOccurrenceAt: 2,
}

describe('Rollbar descriptor rows', () => {
  it('round-trips connection and item identities without delimiter ambiguity', () => {
    const id = rollbarRailItemId(ITEM)
    expect(id).toBe('rollbar%3Aproduction:142%2F7')
    expect(parseRollbarRailItemId(id)).toEqual({
      integrationId: ITEM.integrationId,
      identifier: ITEM.identifier,
    })
    expect(parseRollbarRailItemId('not-a-target')).toBeNull()
    expect(parseRollbarRailItemId('%broken:value')).toBeNull()
  })

  it('carries a host-owned promotion seed without provider secrets or payload bodies', () => {
    expect(rollbarRailItem(ITEM)).toEqual({
      id: 'rollbar%3Aproduction:142%2F7',
      title: 'Checkout failed',
      fields: ['#142/7', 'error', 'production', 'Production'],
      badge: '12 occurrences',
      task: {
        origin: 'rollbar',
        title: 'Checkout failed',
        link: {
          connectionId: 'rollbar:production',
          identifier: '142/7',
          ref: {
            displayId: '142/7',
            externalId: '999',
            url: 'https://rollbar.com/item/999/',
          },
        },
      },
    })
  })
})
