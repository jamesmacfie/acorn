import { describe, expect, it } from 'vitest'
import { fileFilterMarks } from './fileFilter'

describe('fileFilterMarks', () => {
  const path = 'src/common/calendar/Cell.module.css'

  it('marks a whole match where it appears last, which is usually the file name', () => {
    expect(fileFilterMarks('cell', path)).toEqual([20, 21, 22, 23])
  })

  it('falls back to a fuzzy subsequence', () => {
    expect(fileFilterMarks('cmc', path)).toEqual([2, 6, 11])
  })

  it('filters out a path the query is not a subsequence of', () => {
    expect(fileFilterMarks('xyz', path)).toBeNull()
  })

  it('keeps every file and marks nothing for an empty query', () => {
    expect(fileFilterMarks('  ', path)).toEqual([])
  })
})
