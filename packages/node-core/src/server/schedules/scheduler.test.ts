import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import { nextRunAt } from './cadence'
import { type Clock, Scheduler } from './scheduler'

// The loop takes a clock, so nothing here sleeps. `advance` moves the fake now forward and drains the
// single armed timer until nothing is due, which is exactly what the real event loop does — only
// instantly, and with the arming re-read (an async DB read) flushed in between.

const flush = async (): Promise<void> => {
  for (let i = 0; i < 30; i++) await new Promise((resolve) => setImmediate(resolve))
}

function fakeClock() {
  let now = 1_800_000_000_000
  let pending: { at: number; fn: () => void } | null = null
  const clock: Clock = {
    now: () => now,
    setTimeout: (fn, ms) => {
      pending = { at: now + ms, fn }
      return pending
    },
    clearTimeout: (handle) => {
      if (pending === handle) pending = null
    },
    random: () => 0.5, // the midpoint of the ±5% band: no skew, so the arithmetic in tests is exact
  }
  return {
    clock,
    at: () => now,
    async advance(ms: number): Promise<void> {
      now += ms
      await flush()
      for (let i = 0; i < 40; i++) {
        if (!pending || pending.at > now) break
        const fire = pending
        pending = null
        fire.fn()
        await flush()
      }
    },
  }
}

describe('scheduler', () => {
  let test: TestDb
  beforeEach(() => {
    test = makeTestDb()
  })
  afterEach(() => test.cleanup())

  const state = async (key: string) =>
    (await test.db.select().from(schema.scheduleState).where(eq(schema.scheduleState.key, key)))[0]

  it('runs a due schedule, records the run, and re-times from now', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    let ran = 0
    scheduler.register({
      key: 'core:sample',
      name: 'Sample',
      cadence: { every: 60 },
      run: async () => {
        ran += 1
        return `${ran} sampled`
      },
    })
    await scheduler.start()
    expect(ran).toBe(0) // a fresh schedule is timed forward, never fired at boot

    await time.advance(60_000)
    expect(ran).toBe(1)
    const runs = await scheduler.runs('core:sample')
    expect(runs[0]).toMatchObject({ status: 'ok', detail: '1 sampled' })
    expect((await state('core:sample'))!.nextRunAt).toBe(time.at() + 60_000)

    await time.advance(60_000)
    expect(ran).toBe(2)
    await scheduler.stop()
  })

  it('catches up ONCE for a schedule the node slept through, rather than backfilling every interval', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    let ran = 0
    scheduler.register({ key: 'core:sample', name: 'Sample', cadence: { every: 60 }, run: async () => void (ran += 1) })
    await scheduler.start()
    // Twelve hours of missed minutes. Backfill would be 720 runs; catch-up is one.
    await time.advance(12 * 60 * 60_000)
    expect(ran).toBe(1)
    expect((await scheduler.runs('core:sample'))[0]!.detail).toBe('catch-up')
    expect((await state('core:sample'))!.nextRunAt).toBe(time.at() + 60_000)
    await scheduler.stop()
  })

  it('skips rather than overlaps a schedule whose previous run is still going', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    let release!: () => void
    let starts = 0
    scheduler.register({
      key: 'core:slow',
      name: 'Slow',
      cadence: { every: 60 },
      run: () => {
        starts += 1
        return new Promise<void>((resolve) => (release = resolve))
      },
    })
    // A second, fast schedule keeps the timer armed while the slow one overruns its own cadence —
    // which is the only way the loop ever looks at a schedule that is already running.
    scheduler.register({ key: 'core:fast', name: 'Fast', cadence: { every: 30 }, run: async () => {} })
    await scheduler.start()
    await time.advance(60_000)
    expect(starts).toBe(1)

    // Pressing run-now on a running schedule is told so, rather than silently overlapping.
    await expect(scheduler.runNow('core:slow')).rejects.toThrow(/already running/)

    // And the loop records the overrun rather than starting a second copy.
    await time.advance(120_000)
    expect(starts).toBe(1)
    expect((await scheduler.runs('core:slow')).some((run) => run.status === 'skipped')).toBe(true)

    release()
    await flush()
    await scheduler.stop()
  })

  it('never runs more than four jobs at once', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    let live = 0
    let peak = 0
    const releases: (() => void)[] = []
    for (let i = 0; i < 8; i++) {
      scheduler.register({
        key: `core:job-${i}`,
        name: `Job ${i}`,
        cadence: { every: 60 },
        run: () => {
          live += 1
          peak = Math.max(peak, live)
          return new Promise<void>((resolve) => releases.push(() => {
            live -= 1
            resolve()
          }))
        },
      })
    }
    await scheduler.start()
    await time.advance(60_000)
    expect(peak).toBe(4)
    while (releases.length) releases.pop()!()
    await flush()
    await scheduler.stop()
  })

  it('backs a failing schedule off visibly, and never sooner than its cadence would have fired', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    scheduler.register({
      key: 'core:flaky',
      name: 'Flaky',
      cadence: { every: 300 },
      run: async () => {
        throw new Error('upstream said no\nstack line nobody needs')
      },
    })
    await scheduler.start()
    await time.advance(300_000)

    const first = (await state('core:flaky'))!
    expect(first.lastStatus).toBe('error')
    expect(first.lastError).toBe('upstream said no') // one line, not a stack
    expect(first.backoffUntil).toBe(time.at() + 600_000) // cadence × 2¹
    expect(first.nextRunAt).toBe(first.backoffUntil)

    await time.advance(600_000)
    expect((await state('core:flaky'))!.backoffUntil).toBe(time.at() + 1_200_000) // × 2²

    const row = (await scheduler.list()).find((entry) => entry.key === 'core:flaky')!
    expect(row.lastError).toBe('upstream said no')
    expect(row.backoffUntil).toBeGreaterThan(time.at())
    await scheduler.stop()
  })

  it('records a run that outlives its timeout as a timeout', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    scheduler.register({
      key: 'core:hang',
      name: 'Hang',
      cadence: { every: 60 },
      timeoutMs: 20,
      run: () => new Promise<void>(() => {}), // never settles; only the signal ends it
    })
    await scheduler.start()
    await time.advance(60_000)
    // The abort is a real timer (AbortSignal.timeout), so this is the one wait in the suite.
    await new Promise((resolve) => setTimeout(resolve, 60))
    await flush()
    expect((await scheduler.runs('core:hang'))[0]!.status).toBe('timeout')
    await scheduler.stop()
  })

  it('stops the loop when paused without touching a single row', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    let ran = 0
    scheduler.register({ key: 'core:sample', name: 'Sample', cadence: { every: 60 }, run: async () => void (ran += 1) })
    await scheduler.start()
    const before = await state('core:sample')

    await scheduler.setPaused(true)
    await time.advance(10 * 60_000)
    expect(ran).toBe(0)
    expect(await state('core:sample')).toEqual(before)

    await scheduler.setPaused(false)
    await time.advance(0)
    expect(ran).toBe(1) // one catch-up, not ten
    await scheduler.stop()
  })

  it('honours the owner’s pause and retune over the declared cadence', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    let ran = 0
    scheduler.register({ key: 'core:sample', name: 'Sample', cadence: { every: 3600 }, run: async () => void (ran += 1) })
    await scheduler.start()

    await scheduler.patch('core:sample', { enabled: false })
    await time.advance(4 * 3_600_000)
    expect(ran).toBe(0)

    // Clamped, not rejected: 5 seconds is below the floor, so it becomes the floor.
    const row = await scheduler.patch('core:sample', { enabled: true, cadence: { every: 5 } })
    expect(row.cadence).toEqual({ every: 60 })
    expect(row.declaredCadence).toEqual({ every: 3600 })
    await time.advance(60_000)
    expect(ran).toBe(1)
    await scheduler.stop()
  })

  it('retains the state row of a schedule nothing declares, and reattaches when it comes back', async () => {
    const time = fakeClock()
    const first = new Scheduler(test.db, { clock: time.clock })
    const registration = first.register({ key: 'linear:refresh', name: 'Refresh', cadence: { every: 600 }, run: async () => {} })
    await first.start()
    await first.patch('linear:refresh', { enabled: false })
    registration.dispose() // the plugin was disabled
    await first.stop()

    const orphan = (await new Scheduler(test.db, { clock: time.clock }).list()).find((row) => row.key === 'linear:refresh')!
    expect(orphan).toMatchObject({ owner: 'plugin', pluginId: 'linear', registered: false, enabled: false })

    const second = new Scheduler(test.db, { clock: time.clock })
    second.register({ key: 'linear:refresh', name: 'Refresh', cadence: { every: 600 }, run: async () => {} })
    await second.start()
    const back = (await second.list()).find((row) => row.key === 'linear:refresh')!
    expect(back).toMatchObject({ registered: true, enabled: false }) // the pause survived the absence
    await second.stop()
  })

  it('refuses to create a user schedule for a kind nothing can run, and keeps an unknown one inert', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    await scheduler.start()
    await expect(scheduler.create({ name: 'Nightly', kind: 'node-action', target: {}, cadence: { every: 3600 } })).rejects.toThrow(
      /nothing that can run/,
    )

    // A row written by a version that HAD the kind: listed, never run, never deleted.
    await test.db.insert(schema.userSchedules).values({
      id: 'abc',
      name: 'Nightly prune',
      kind: 'node-action',
      target: '{}',
      cadence: JSON.stringify({ every: 3600 }),
      risk: 'execute',
      createdAt: time.at(),
    })
    const row = (await scheduler.list()).find((entry) => entry.key === 'user:abc')!
    expect(row).toMatchObject({ owner: 'user', registered: false, risk: 'execute', name: 'Nightly prune' })
    await expect(scheduler.runNow('user:abc')).rejects.toThrow(/Nothing on this node can run/)
    await scheduler.stop()
  })

  it('deletes a user schedule and refuses to delete a declared one', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    scheduler.register({ key: 'core:sample', name: 'Sample', cadence: { every: 60 }, run: async () => {} })
    scheduler.registerTarget({
      kind: 'noop',
      risk: 'read',
      parse: (target) => target,
      run: async () => 'did nothing',
    })
    await scheduler.start()

    const created = await scheduler.create({ name: 'Mine', kind: 'noop', target: { a: 1 }, cadence: { every: 3600 } })
    expect(created).toMatchObject({ owner: 'user', registered: true, risk: 'read' })
    expect(await scheduler.runNow(created.key)).toMatchObject({ status: 'ok', detail: 'did nothing' })

    await expect(scheduler.remove('core:sample')).rejects.toThrow(/cannot be deleted/)
    await scheduler.remove(created.key)
    expect((await scheduler.list()).some((row) => row.key === created.key)).toBe(false)
    await scheduler.stop()
  })

  it('keeps only the twenty most recent runs of a schedule', async () => {
    const time = fakeClock()
    const scheduler = new Scheduler(test.db, { clock: time.clock })
    scheduler.register({ key: 'core:sample', name: 'Sample', cadence: { every: 60 }, run: async () => {} })
    await scheduler.start()
    for (let i = 0; i < 25; i++) await time.advance(60_000)
    expect(await scheduler.runs('core:sample')).toHaveLength(20)
    await scheduler.stop()
  })
})

describe('cadence', () => {
  it('skews interval cadences by ±5% and leaves dated ones on their wall clock', () => {
    const from = 1_800_000_000_000
    expect(nextRunAt({ every: 3600 }, from, () => 0)).toBe(from + 3_420_000) // −5%
    expect(nextRunAt({ every: 3600 }, from, () => 1)).toBe(from + 3_780_000) // +5%

    const daily = new Date(nextRunAt({ daily: '03:30' }, from))
    expect([daily.getHours(), daily.getMinutes(), daily.getSeconds()]).toEqual([3, 30, 0])
    expect(daily.getTime()).toBeGreaterThan(from)

    const weekly = new Date(nextRunAt({ weekly: { day: 1, at: '09:00' } }, from))
    expect(weekly.getDay()).toBe(1)
    expect([weekly.getHours(), weekly.getMinutes()]).toEqual([9, 0])
    expect(weekly.getTime()).toBeGreaterThan(from)
    expect(weekly.getTime() - from).toBeLessThanOrEqual(7 * 24 * 3_600_000)
  })
})
