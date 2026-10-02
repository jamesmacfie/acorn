import { describe, expect, it } from 'vitest'
import type { Task } from '@acorn/protocol/api.ts'
import { canonicalIdentifier, failureReason, formatDate, linearIdentifierFromHref, relativeTime, taskLinearTargets } from './model'

const task = (links: Task['links']): Task => ({ id: 't1', links } as Task)

describe('linear frame helpers', () => {
  it('reads only this provider’s links off a task, in link order', () => {
    expect(taskLinearTargets(task([
      { providerId: 'rollbar', connectionId: 'rb', identifier: '142' },
      { providerId: 'linear', connectionId: 'linear-b', identifier: 'ENG-2' },
      { providerId: 'linear', connectionId: 'linear-a', identifier: 'ENG-1' },
    ] as Task['links']))).toEqual([
      { connectionId: 'linear-b', identifier: 'ENG-2' },
      { connectionId: 'linear-a', identifier: 'ENG-1' },
    ])
    expect(taskLinearTargets(undefined)).toEqual([])
  })

  it('recognises a linear.app issue link with or without the title slug, and normalises the case', () => {
    // The slug form is what Linear's own "copy link" produces, and it is lower-cased. Both arities
    // matter: the host's bounded content-link grammar needs one entry each, which is the finding.
    expect(linearIdentifierFromHref('https://linear.app/acme/issue/ENG-42')).toBe('ENG-42')
    expect(linearIdentifierFromHref('https://linear.app/acme/issue/cra-275/some-slug')).toBe('CRA-275')
    expect(linearIdentifierFromHref('https://linear.app/acme/project/abc')).toBeNull()
    expect(linearIdentifierFromHref(null)).toBeNull()
  })

  it('upper-cases whatever named the ticket, because the route filter only accepts that form', () => {
    expect(canonicalIdentifier(' eng-42 ')).toBe('ENG-42')
  })

  it('renders an absent timestamp as nothing rather than as "unknown"', () => {
    expect(relativeTime(null)).toBe('')
    expect(relativeTime(1_000, 61_000)).toBe('1m ago')
  })

  it('writes a date as a short month and day, reading a bare date as the local day', () => {
    const short = (date: Date) => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    expect(formatDate('2026-10-06')).toBe(short(new Date(2026, 9, 6)))
    expect(formatDate(null)).toBe('')
  })

  it('turns a route code into a sentence, and keeps prose a route wrote itself', () => {
    const coded = (code: string, message = code) => Object.assign(new Error(message), { code })
    expect(failureReason(coded('provider_needs_auth'))).toBe("Linear turned down acorn's key. Reconnect Linear in Settings.")
    expect(failureReason(coded('bad_request'))).toBe('Something went wrong. Try again.')
    expect(failureReason(new Error('The issue was archived.'))).toBe('The issue was archived.')
  })
})
