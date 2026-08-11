import { describe, expect, it } from 'vitest'
import { createArmedDelete } from './confirmDelete'

describe('two-click delete', () => {
  it('needs a second click on the same row', () => {
    const gate = createArmedDelete()
    expect(gate.request('a')).toBe(false)
    expect(gate.armed()).toBe('a')
    expect(gate.request('a')).toBe(true)
    // Committing disarms, so a third click starts over rather than deleting again.
    expect(gate.armed()).toBe(null)
    expect(gate.request('a')).toBe(false)
  })

  it('arming another row cancels the first', () => {
    const gate = createArmedDelete()
    gate.request('a')
    expect(gate.request('b')).toBe(false)
    expect(gate.armed()).toBe('b')
    expect(gate.request('a')).toBe(false)
  })

  it('disarms on request', () => {
    const gate = createArmedDelete()
    gate.request('a')
    gate.disarm()
    expect(gate.armed()).toBe(null)
    expect(gate.request('a')).toBe(false)
  })
})
