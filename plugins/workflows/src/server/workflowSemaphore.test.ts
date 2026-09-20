import { describe, expect, it } from 'vitest'
import { Semaphore } from './workflowSemaphore'

describe('workflow spawn semaphore', () => {
  it('never runs more than the configured number of handlers and drains queued work', async () => {
    const semaphore = new Semaphore(2)
    const controller = new AbortController()
    let active = 0
    let peak = 0
    const jobs = Array.from({ length: 6 }, (_, index) =>
      semaphore.use(controller.signal, async () => {
        active += 1
        peak = Math.max(peak, active)
        await new Promise((resolve) => setTimeout(resolve, 5))
        active -= 1
        return index
      }),
    )
    expect(await Promise.all(jobs)).toEqual([0, 1, 2, 3, 4, 5])
    expect(peak).toBe(2)
  })

  it('removes an aborted queued handler without consuming a slot', async () => {
    const semaphore = new Semaphore(1)
    const first = new AbortController()
    const queued = new AbortController()
    let release!: () => void
    const running = semaphore.use(first.signal, () => new Promise<void>((resolve) => (release = resolve)))
    const waiting = semaphore.use(queued.signal, async () => undefined)
    queued.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    release()
    await running
  })

  it('shares four slots and skips a saturated root without blocking other roots', async () => {
    const semaphore = new Semaphore(4)
    const signal = new AbortController().signal
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const started: string[] = []
    let active = 0
    let peak = 0
    const job = (name: string, key: string, limit: number) => semaphore.use(signal, async () => {
      started.push(name)
      peak = Math.max(peak, ++active)
      await blocked
      active--
    }, { key, limit })
    const jobs = [job('a1', 'a', 1), job('a2', 'a', 1), ...[1, 2, 3, 4].map(id => job(`b${id}`, 'b', 4))]
    await Promise.resolve()
    expect(started).toEqual(['a1', 'b1', 'b2', 'b3'])
    release()
    await Promise.all(jobs)
    expect(peak).toBe(4)
    expect(started).toContain('a2')
  })
})
