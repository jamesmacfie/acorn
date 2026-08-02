import { describe, expect, it } from 'vitest'
import { boundProviderEvent } from './boundProviderEvent'

describe('provider event storage bounds', () => {
  it('bounds request collections and redacts diagnostics before persistence', () => {
    const request = boundProviderEvent({
      type: 'request',
      requestId: 'r',
      kind: 'question',
      title: 't'.repeat(1_000),
      options: Array.from({ length: 150 }, (_, index) => ({
        id: String(index),
        label: 'label',
        kind: 'other' as const,
      })),
    }, [])
    expect(request.type === 'request' && request.title).toHaveLength(500)
    expect(request.type === 'request' && request.options).toHaveLength(100)

    const diagnostic = boundProviderEvent({
      type: 'diagnostic',
      level: 'warning',
      message: 'token=private-token-value',
    }, ['private-token-value'])
    expect(diagnostic.type === 'diagnostic' ? diagnostic.message : '').not.toContain('private-token-value')
  })
})
