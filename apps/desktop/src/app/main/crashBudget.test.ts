import { describe, expect, it } from 'vitest'
import { CRASH_WINDOW_MS, MAX_CRASHES_PER_WINDOW, recordCrash } from './crashBudget'

// This is the logic where a mistake reaches a user as either "the app won't stop restarting" or "the
// app gave up too early". Neither is visible to tsc, and before the extraction neither could be
// exercised without booting Electron and crashing a real service five times.
describe('crash budget', () => {
  it('backs off further with each crash, then gives up on the sixth in the window', () => {
    const times: number[] = []
    const delays = Array.from({ length: MAX_CRASHES_PER_WINDOW }, (_, i) => recordCrash(times, i * 1_000))
    expect(delays.map((d) => (d.retry ? d.delayMs : null))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000])
    expect(recordCrash(times, 5_000)).toEqual({ retry: false })
  })

  // The window is what makes this "five crashes in ten minutes" rather than "five crashes ever". A node
  // that crashes once a month must never accumulate its way to a permanent recovery screen.
  it('forgets crashes that fall outside the window', () => {
    const times: number[] = []
    for (let i = 0; i < MAX_CRASHES_PER_WINDOW; i++) recordCrash(times, i * 1_000)
    // Well past the window, so every earlier crash is forgotten and this reads as the first one again.
    // The boundary is inclusive: a crash exactly `CRASH_WINDOW_MS` old still counts, which is why this
    // is not `CRASH_WINDOW_MS + 1`.
    const muchLater = CRASH_WINDOW_MS * 2
    expect(recordCrash(times, muchLater)).toEqual({ retry: true, delayMs: 1_000 })
    expect(times).toEqual([muchLater])
  })

  it('clamps to the longest backoff rather than reading past the table', () => {
    const times = [0, 0, 0, 0]
    expect(recordCrash(times, 0)).toEqual({ retry: true, delayMs: 16_000 })
  })
})
