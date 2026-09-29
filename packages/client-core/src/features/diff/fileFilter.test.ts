import { describe, expect, it } from 'vitest'
import { fileFilterMarks } from './fileFilter'

describe('fileFilterMarks', () => {
  const path = 'src/common/calendar/Cell.module.css'

  it('marks a whole match where it appears last, which is usually the file name', () => {
    expect(fileFilterMarks('cell', path)).toEqual([20, 21, 22, 23])
  })

  it('filters out a path that holds the letters but not the whole query', () => {
    expect(fileFilterMarks('cmc', path)).toBeNull()
  })

  it('keeps every file and marks nothing for an empty query', () => {
    expect(fileFilterMarks('  ', path)).toEqual([])
  })
})
