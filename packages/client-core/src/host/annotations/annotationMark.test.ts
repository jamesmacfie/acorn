import { describe, expect, it } from 'vitest'
import { MAX_ANNOTATION_DETAIL_BYTES } from '@acorn/protocol/extensionPoints.ts'
import { sanitizeAnnotationMark } from './annotationMark'

const mark = { key: { line: 1 }, severity: 'info', text: 'Ada, 4 years ago' }

describe('sanitizeAnnotationMark', () => {
  it('keeps markdown and plain-text detail', () => {
    for (const kind of ['markdown', 'plaintext'] as const)
      expect(sanitizeAnnotationMark({ ...mark, detail: { kind, value: 'Fix the build' } })).toEqual({
        ...mark,
        detail: { kind, value: 'Fix the build' },
      })
  })

  it('drops malformed or oversize detail and keeps the rest of the mark', () => {
    for (const detail of [
      { kind: 'html', value: '<b>x</b>' },
      { kind: 'markdown', value: '' },
      { kind: 'markdown', value: 42 },
      'Fix the build',
      // Under the cap in characters, over it in UTF-8.
      { kind: 'plaintext', value: '€'.repeat(MAX_ANNOTATION_DETAIL_BYTES / 2) },
    ])
      expect(sanitizeAnnotationMark({ ...mark, icon: 'git-commit', detail })).toEqual({ ...mark, icon: 'git-commit' })
  })

  it('keeps detail at exactly the cap', () => {
    const value = 'a'.repeat(MAX_ANNOTATION_DETAIL_BYTES)
    expect(sanitizeAnnotationMark({ ...mark, detail: { kind: 'plaintext', value } })?.detail?.value).toBe(value)
  })

  it('refuses a mark with no text, an unknown severity, or a key that is not scalars', () => {
    expect(sanitizeAnnotationMark({ ...mark, text: '' })).toBeNull()
    expect(sanitizeAnnotationMark({ ...mark, severity: 'loud' })).toBeNull()
    expect(sanitizeAnnotationMark({ ...mark, key: { line: { nested: true } } })).toBeNull()
  })
})
