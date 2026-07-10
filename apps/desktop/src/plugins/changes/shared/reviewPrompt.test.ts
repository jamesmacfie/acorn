import { describe, expect, it } from 'vitest'
import type { ReviewNote } from '../../../core/shared/api'
import { formatReviewPrompt } from './reviewPrompt'

const note = (over: Partial<ReviewNote>): ReviewNote => ({
  id: 'n1',
  taskId: 't1',
  path: 'src/auth/login.ts',
  side: 'additions',
  startLine: 42,
  endLine: 48,
  snippet: 'const token = null',
  body: 'Handle the null token case before the redirect.',
  sentAt: null,
  createdAt: 0,
  ...over,
})

describe('formatReviewPrompt (docs/panes.md)', () => {
  it('matches the doc format: numbered, path:range, quoted snippet, body', () => {
    const out = formatReviewPrompt([
      note({}),
      note({ id: 'n2', startLine: 80, endLine: 80, snippet: 'console.log(token)', body: 'This log line leaks the token — drop it.' }),
    ])
    expect(out).toBe(
      `Please address these review notes on the current changes:

1. src/auth/login.ts:42–48
   > const token = null
   Handle the null token case before the redirect.

2. src/auth/login.ts:80
   > console.log(token)
   This log line leaks the token — drop it.`,
    )
  })
  it('handles multi-line snippets and missing snippets', () => {
    const out = formatReviewPrompt([note({ snippet: 'a\nb' }), note({ id: 'n2', snippet: null, startLine: 1, endLine: 1 })])
    expect(out).toContain('   > a\n   > b\n')
    expect(out).toContain('2. src/auth/login.ts:1\n   Handle')
  })
})
