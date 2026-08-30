import { describe, expect, it } from 'vitest'
import { activeMention, completeMention, scrollDeltaFor } from './mentions'

const SIGILS = ['@', '/', '$']

describe('activeMention', () => {
  it('reads the sigil at the caret, so one field serves files, commands and skills', () => {
    expect(activeMention('run /rev', 'run /rev'.length, SIGILS))
      .toEqual({ sigil: '/', start: 4, end: 8, query: 'rev' })
    expect(activeMention('then $read', 'then $read'.length, SIGILS))
      .toEqual({ sigil: '$', start: 5, end: 10, query: 'read' })
  })

  it('only counts a sigil at a word boundary', () => {
    expect(activeMention('a@b.com', 'a@b.com'.length, SIGILS)).toBeNull()
    // Mid-word, not a mention: 9/11 and and/or are the everyday false positives.
    expect(activeMention('shipped 9/11', 'shipped 9/11'.length, SIGILS)).toBeNull()
  })

  it('ignores a sigil no source declared', () => {
    expect(activeMention('run /rev', 'run /rev'.length, ['@'])).toBeNull()
  })

  it('takes the whole word the caret is inside, not just what is behind it', () => {
    expect(activeMention('Check @src/comp before', 'Check @src/co'.length, SIGILS))
      .toEqual({ sigil: '@', start: 6, end: 'Check @src/comp'.length, query: 'src/co' })
  })

  it('keeps the spaces inside a quoted token', () => {
    const text = 'Review @"docs/product br'
    expect(activeMention(text, text.length, SIGILS))
      .toEqual({ sigil: '@', start: 7, end: text.length, query: 'docs/product br' })
  })
})

describe('completeMention', () => {
  it('replaces the token and lands the caret past one following space', () => {
    const text = 'run /rev now'
    const mention = activeMention(text, 'run /rev'.length, SIGILS)
    expect(completeMention(text, mention!, '/review')).toEqual({
      text: 'run /review now',
      cursor: 'run /review '.length,
    })
  })

  it('adds the space when the mention ends the draft', () => {
    const text = 'run /rev'
    const mention = activeMention(text, text.length, SIGILS)
    expect(completeMention(text, mention!, '/review')).toEqual({
      text: 'run /review ',
      cursor: 'run /review '.length,
    })
  })
})

describe('scrollDeltaFor', () => {
  const list = { top: 100, bottom: 300 }

  it('is zero for a row that already fits', () => {
    expect(scrollDeltaFor(list, { top: 120, bottom: 160 })).toBe(0)
    expect(scrollDeltaFor(list, { top: 100, bottom: 140 })).toBe(0)
    expect(scrollDeltaFor(list, { top: 260, bottom: 300 })).toBe(0)
  })

  it('reveals a row past either edge', () => {
    expect(scrollDeltaFor(list, { top: 310, bottom: 350 })).toBe(50)
    expect(scrollDeltaFor(list, { top: 60, bottom: 100 })).toBe(-40)
  })

  it('puts the top of a row taller than the list in view', () => {
    expect(scrollDeltaFor(list, { top: 40, bottom: 400 })).toBe(-60)
  })
})
