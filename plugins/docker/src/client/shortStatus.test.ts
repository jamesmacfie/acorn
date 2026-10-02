import { describe, expect, it } from 'vitest'
import { shortStatus } from './shortStatus'

describe('shortStatus', () => {
  it('shortens the sentences docker writes', () => {
    expect(shortStatus('Up 6 hours (healthy)')).toBe('Up 6h')
    expect(shortStatus('Exited (137) 31 minutes ago')).toBe('Exited 31m ago')
    expect(shortStatus('Up About an hour')).toBe('Up 1h')
    expect(shortStatus('Up Less than a second')).toBe('Up <1s')
    expect(shortStatus('Up 2 weeks (Paused)')).toBe('Up 2w')
    expect(shortStatus('Created')).toBe('Created')
  })
})
