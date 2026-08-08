import { describe, expect, it } from 'vitest'
import type { ExternalRef } from '@acorn/protocol/integrations.ts'
import { rollbarProvider } from './provider'

const ref: ExternalRef = { providerId: 'rollbar', connectionId: 'conn-1', displayId: '142' }

describe('rollbar provider cache contract', () => {
  it('migrates a legacy bare item into the current versioned summary', () => {
    const parsed = rollbarProvider.codec!.parse({
      integrationId: 'conn-1', identifier: '142', title: 'TypeError', level: 'error',
      environment: 'prod', status: 'active', totalOccurrences: 3, firstOccurrenceAt: 1, lastOccurrenceAt: 2,
    }, ref)

    expect(parsed).toMatchObject({ ok: true, migrated: true })
    if (!parsed.ok) return
    expect(parsed.value.schemaVersion).toBe(4)
    expect(parsed.value.summary).toMatchObject({
      integrationId: 'conn-1', identifier: '142', title: 'TypeError', itemId: '', url: null,
      totalOccurrences: 3,
    })
  })

  it('rejects malformed cache values and preserves detail on summary refresh', () => {
    expect(rollbarProvider.codec!.parse({ nope: true }, ref)).toEqual({ ok: false, error: 'invalid_rollbar_cache' })
    const detail = { resolvedInVersion: 'abc', assignedTo: 'james' }
    const summary = { integrationId: 'conn-1', integrationLabel: 'Rollbar · acme', identifier: '142', itemId: '999', url: 'https://rollbar.com/item/999/', title: 'TypeError', level: 'error', environment: 'prod', status: 'active', totalOccurrences: 4, firstOccurrenceAt: 1, lastOccurrenceAt: 3 }
    const merged = rollbarProvider.codec!.mergeSummary(
      { ref, summary, detail, detailFetchedAt: 10, listFetchedAt: 20, schemaVersion: 4 },
      ref,
      { ...summary, title: 'Updated' },
      30,
    )
    expect(merged).toMatchObject({ summary: { title: 'Updated' }, detail, detailFetchedAt: 10, listFetchedAt: 30, schemaVersion: 4 })
  })
})
