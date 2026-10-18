import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { childInhibitor, createKeepAwake, type Inhibitor } from './power'

function fakeInhibitor() {
  const calls = { starts: 0, stops: 0, end: null as (() => void) | null }
  const inhibitor: Inhibitor = (ended) => {
    calls.starts += 1
    calls.end = ended
    return () => {
      calls.stops += 1
    }
  }
  return { inhibitor, calls }
}

describe('createKeepAwake', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = (setting: string | null = null) => {
    const fake = fakeInhibitor()
    const pref = { value: setting }
    const keepAwake = createKeepAwake({ inhibitor: fake.inhibitor, readSetting: async () => pref.value })
    return { ...fake, pref, keepAwake }
  }

  it('starts on the first lease and stops a minute after the last release', async () => {
    const { calls, keepAwake } = setup()
    const first = keepAwake.hold()
    const second = keepAwake.hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.starts).toBe(1)

    first()
    second()
    second()
    await vi.advanceTimersByTimeAsync(59_000)
    expect(calls.stops).toBe(0)
    expect(await keepAwake.status()).toEqual({ setting: 'while-busy', available: true, held: 0 })
    await vi.advanceTimersByTimeAsync(1_000)
    expect(calls.stops).toBe(1)
  })

  it('keeps running when a lease arrives inside the wait', async () => {
    const { calls, keepAwake } = setup()
    keepAwake.hold()()
    await vi.advanceTimersByTimeAsync(30_000)
    const next = keepAwake.hold()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toMatchObject({ starts: 1, stops: 0 })
    next()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toMatchObject({ starts: 1, stops: 1 })
  })

  it('starts nothing when the preference is never, and stops when it changes to never', async () => {
    const { calls, pref, keepAwake } = setup('never')
    keepAwake.hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.starts).toBe(0)

    pref.value = 'while-busy'
    expect(await keepAwake.status()).toEqual({ setting: 'while-busy', available: true, held: 1 })
    expect(calls.starts).toBe(1)
    pref.value = 'never'
    await keepAwake.status()
    expect(calls.stops).toBe(1)
  })

  it('stops at the drain and starts nothing after it', async () => {
    const { calls, keepAwake } = setup()
    keepAwake.hold()
    await vi.advanceTimersByTimeAsync(0)
    keepAwake.stop()
    expect(calls.stops).toBe(1)
    keepAwake.hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.starts).toBe(1)
  })

  it('reports unavailable once the inhibitor ends on its own, and stops retrying', async () => {
    const { calls, keepAwake } = setup()
    keepAwake.hold()
    await vi.advanceTimersByTimeAsync(0)
    calls.end!()
    expect(await keepAwake.status()).toMatchObject({ available: false })
    keepAwake.hold()
    await vi.advanceTimersByTimeAsync(0)
    expect(calls.starts).toBe(1)
  })

  it('reports unavailable on a platform with no inhibitor', async () => {
    const keepAwake = createKeepAwake({ inhibitor: null, readSetting: async () => null })
    keepAwake.hold()
    expect(await keepAwake.status()).toEqual({ setting: 'while-busy', available: false, held: 1 })
  })
})

describe('childInhibitor', () => {
  const node = process.execPath

  it('reports a command that is missing or exits on its own', async () => {
    for (const inhibitor of [
      childInhibitor('acorn-no-such-command', []),
      childInhibitor(node, ['-e', 'process.exit(1)']),
    ]) {
      await new Promise<void>((resolve) => inhibitor(resolve))
    }
  })

  it("doesn't report its own stop", async () => {
    const ended = vi.fn()
    const stop = childInhibitor(node, ['-e', 'process.stdin.resume()'])(ended)
    await new Promise((resolve) => setTimeout(resolve, 200))
    stop()
    await new Promise((resolve) => setTimeout(resolve, 200))
    expect(ended).not.toHaveBeenCalled()
  })
})
