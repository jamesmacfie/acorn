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
})
