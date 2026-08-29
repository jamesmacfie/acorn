import { describe, expect, it } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import type { RollbarItemMetadata, RollbarOccurrenceDetail } from '../shared/api'
import { occurrenceContext, relativeTime, taskRollbarTargets } from './model'

describe('Rollbar frame model', () => {
  it('keeps only Rollbar links from the host task projection', () => {
    const task = {
      links: [
        { providerId: 'linear', connectionId: 'linear-1', identifier: 'ENG-1' },
        { providerId: 'rollbar', connectionId: 'rollbar-1', identifier: '142' },
      ],
    } as Task
    expect(taskRollbarTargets(task)).toEqual([{ integrationId: 'rollbar-1', identifier: '142' }])
  })

  it('formats bounded relative times', () => {
    expect(relativeTime(999_000, 1_000_000)).toBe('1s ago')
    expect(relativeTime(940_000, 1_000_000)).toBe('1m ago')
    expect(relativeTime(null, 1_000_000)).toBe('unknown')
  })

  it('copies a privacy-bounded context projection', () => {
    const item = {
      identifier: '142', level: 'error', title: 'Checkout failed', totalOccurrences: 5,
      environment: 'production', url: 'https://rollbar.com/item/9/',
    } as RollbarItemMetadata
    const occurrence = {
      exceptionClass: 'Error', message: 'boom', environment: 'production', codeVersion: 'abc',
      request: { method: 'POST', url: '/checkout' }, context: 'purchase',
      frames: [{ filename: 'src/checkout.ts', line: 12, method: 'run', inProject: true, column: null, code: [] }],
      person: { id: '7', username: 'sam', email: 'private@example.com' },
    } as unknown as RollbarOccurrenceDetail
    const text = occurrenceContext(item, occurrence)
    expect(text).toContain('Rollbar #142 [error] Checkout failed')
    expect(text).toContain('at src/checkout.ts:12 (run)')
    expect(text).not.toContain('private@example.com')
  })
})
