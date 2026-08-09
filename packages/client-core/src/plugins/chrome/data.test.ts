import { describe, expect, it } from 'vitest'
import { ownsRoute } from './data'

describe('descriptor route confinement', () => {
  it('normalizes dot segments before accepting the plugin namespace', () => {
    expect(ownsRoute('board', '/v2/p/board/items?task=t1')).toBe(true)
    expect(ownsRoute('board', '/v2/p/board/../other/items')).toBe(false)
    expect(ownsRoute('board', '/v2/p/board-other/items')).toBe(false)
  })
})
