import { describe, expect, it } from 'vitest'
import { annotationKeyOf } from '@acorn/protocol/extensionPoints.ts'
import type { CodeRow } from '../ui/diff/model'
import { DIFF_ANNOTATION_FIELDS, annotationKey } from './annotationKey'

// The two halves of a diff annotation, held against each other (docs/plugins.md § Cooperative
// extension points, the `annotation` kind).
//
// An owner declares its key FIELDS in its manifest or its contribution; this module mints the VALUES
// per row. The host looks a mark up by joining the declared fields in order, so a value whose field
// name drifted from the declaration matches nothing and draws nothing — silently, because an
// unmatched contribution is silent by design. That is the failure this file exists to catch.

const row = (over: Partial<CodeRow> = {}): CodeRow =>
  ({ kind: 'insert', path: 'src/auth.ts', oldNo: null, newNo: 42, raw: '+ x', ...over }) as CodeRow

describe('a diff row as an annotation key', () => {
  it('mints exactly the fields the owners declare, and no others', () => {
    expect(Object.keys(annotationKey(row())).sort()).toEqual([...DIFF_ANNOTATION_FIELDS].sort())
  })

  it('answers the new side for an added or context line', () => {
    expect(annotationKey(row())).toEqual({ file: 'src/auth.ts', line: 42, side: 'new' })
  })

  // The view mode is not part of it: a contributor marking "line 42 as it will be" means the new side
  // whether the reader is in split or unified.
  it('answers the old side, and the old number, for a deletion', () => {
    expect(annotationKey(row({ kind: 'delete', oldNo: 17, newNo: null })))
      .toEqual({ file: 'src/auth.ts', line: 17, side: 'old' })
  })

  it('looks up under the same string the owner’s declared field order mints', () => {
    const key = annotationKey(row())
    const lookup = annotationKeyOf([...DIFF_ANNOTATION_FIELDS], key)
    expect(lookup.split('\u0000')).toEqual(['src/auth.ts', '42', 'new'])
    // A mark that answered with the same three fields lands on the same item however else it differs.
    expect(annotationKeyOf([...DIFF_ANNOTATION_FIELDS], { ...key, extra: 'ignored' })).toBe(lookup)
    // And a mark that named the fields in the other order does not, which is the drift this catches.
    expect(annotationKeyOf(['side', 'line', 'file'], key)).not.toBe(lookup)
  })
})
