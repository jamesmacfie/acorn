import { describe, expect, it } from 'vitest'
import { checkStatusWord, checksSummary } from './displayMeta'

describe('check status words', () => {
  it('names every status GitHub sends, in any case', () => {
    expect(checkStatusWord('SUCCESS')).toBe('Passed')
    expect(checkStatusWord('FAILURE')).toBe('Failed')
    expect(checkStatusWord('IN_PROGRESS')).toBe('Running')
    expect(checkStatusWord('TIMED_OUT')).toBe('Timed out')
    expect(checkStatusWord('ACTION_REQUIRED')).toBe('Needs action')
    expect(checkStatusWord('expected')).toBe('Waiting')
    expect(checkStatusWord(null)).toBe('Waiting')
    expect(checkStatusWord('SOMETHING_NEW')).toBe('Something new')
  })

  it('sums the checks up as failing, then needing action, then running, then passed', () => {
    expect(checksSummary([])).toBe('No checks')
    expect(checksSummary([{ status: 'SUCCESS' }, { status: 'SKIPPED' }, { status: 'NEUTRAL' }])).toBe('All checks passed')
    expect(checksSummary([{ status: 'SUCCESS' }, { status: 'FAILURE' }, { status: 'IN_PROGRESS' }])).toBe('1 check failing')
    expect(checksSummary([{ status: 'ACTION_REQUIRED' }, { status: 'QUEUED' }])).toBe('1 check needs action')
    expect(checksSummary([{ status: 'QUEUED' }, { status: null }, { status: 'SUCCESS' }])).toBe('2 checks running')
  })
})
