import { describe, expect, it } from 'vitest'
import { MAX_ANNOTATION_DETAIL_BYTES } from '@acorn/protocol/extensionPoints.ts'
import { sanitizeAnnotationMark } from './annotationMark'

const mark = { key: { line: 1 }, severity: 'info', text: 'Ada, 4 years ago' }

describe('sanitizeAnnotationMark', () => {
  it('keeps markdown and plain-text detail', () => {
    for (const kind of ['markdown', 'plaintext'] as const)
      expect(sanitizeAnnotationMark({ ...mark, detail: { kind, value: 'Fix the build' } }, 'node-a')).toEqual({
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
      expect(sanitizeAnnotationMark({ ...mark, icon: 'git-commit', detail }, 'node-a')).toEqual({
        ...mark,
        icon: 'git-commit',
      })
  })

  it('keeps a busy flag only when it is true', () => {
    expect(sanitizeAnnotationMark({ ...mark, busy: true }, 'node-a')).toEqual({ ...mark, busy: true })
    expect(sanitizeAnnotationMark({ ...mark, busy: 'yes' }, 'node-a')).toEqual(mark)
    expect(sanitizeAnnotationMark({ ...mark, busy: false }, 'node-a')).toEqual(mark)
  })

  it('keeps detail at exactly the cap', () => {
    const value = 'a'.repeat(MAX_ANNOTATION_DETAIL_BYTES)
    expect(sanitizeAnnotationMark({ ...mark, detail: { kind: 'plaintext', value } }, 'node-a')?.detail?.value).toBe(
      value,
    )
  })

  it('rewrites a link to `this` Node in the detail to the Node that answered, and nothing else', () => {
    const value = '[Run](acorn://this/t/task?pane=agents&item=s&at=4) and acorn://thistle/t/x'
    expect(sanitizeAnnotationMark({ ...mark, detail: { kind: 'markdown', value } }, 'node-b')?.detail?.value).toBe(
      '[Run](acorn://node-b/t/task?pane=agents&item=s&at=4) and acorn://thistle/t/x',
    )
  })

  it('refuses a mark with no text, an unknown severity, or a key that is not scalars', () => {
    expect(sanitizeAnnotationMark({ ...mark, text: '' }, 'node-a')).toBeNull()
    expect(sanitizeAnnotationMark({ ...mark, severity: 'loud' }, 'node-a')).toBeNull()
    expect(sanitizeAnnotationMark({ ...mark, key: { line: { nested: true } } }, 'node-a')).toBeNull()
  })
})
