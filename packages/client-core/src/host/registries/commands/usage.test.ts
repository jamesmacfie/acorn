import { describe, expect, it } from 'vitest'
import { decayedScore, MAX_COMMAND_USES, pruneUsage, withUse, type CommandUsage } from './usage'

const WEEK = 7 * 24 * 60 * 60 * 1000

describe('command usage', () => {
  it('halves after one half-life, and two uses a half-life apart sum to 1.5', () => {
    expect(decayedScore({ score: 1, at: 0 }, WEEK)).toBeCloseTo(0.5)
    const twice = withUse(withUse({}, 'cmd', 0), 'cmd', WEEK)
    expect(twice.cmd).toEqual({ score: 1.5, at: WEEK })
  })

  it('never grows when the clock goes backwards', () => {
    expect(decayedScore({ score: 1, at: WEEK }, 0)).toBe(1)
  })

  it('keeps the strongest 200 and drops what faded under 0.05', () => {
    const usage: Record<string, { score: number; at: number }> = { faded: { score: 0.04, at: 0 } }
    for (let at = 0; at < 250; at++) usage[`cmd.${at}`] = { score: at + 1, at: 0 }
    const pruned: CommandUsage = pruneUsage(usage, 0)
    expect(Object.keys(pruned)).toHaveLength(MAX_COMMAND_USES)
    expect(pruned.faded).toBeUndefined()
    expect(pruned['cmd.49']).toBeUndefined()
    expect(pruned['cmd.50']).toBeDefined()
  })
})
