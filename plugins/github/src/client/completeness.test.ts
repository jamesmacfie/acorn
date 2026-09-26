import { describe, expect, it } from 'vitest'
import { fileCountLabel, incompleteFilesMessage } from './completeness'

const capped = { kind: 'incomplete', cause: 'upstream-cap', resource: 'compare-files', received: 300, reportedTotal: null, limit: 300 } as const

describe('file completeness copy', () => {
  it('never counts a capped comparison as all of its files', () => {
    expect(incompleteFilesMessage(capped)).toBe('GitHub shows only the first 300 changed files of a comparison. This one may have more.')
    expect(fileCountLabel(300, capped)).toBe('first 300 files')
    expect(fileCountLabel(12, { kind: 'complete' })).toBe('12 files')
    expect(fileCountLabel(1, undefined)).toBe('1 file')
    expect(incompleteFilesMessage({ kind: 'complete' })).toBeNull()
  })
})
