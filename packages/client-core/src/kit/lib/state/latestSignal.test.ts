import { describe, expect, it } from 'vitest'
import { latestSignal } from './latestSignal'

describe('latestSignal', () => {
  it('aborts the previous flow when a newer one starts', () => {
    const latest = latestSignal()
    const first = latest.next()
    const second = latest.next()

    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(false)
    expect(latest.signal).toBe(second)
  })

  it('drops a multi-step flow at the first await after a newer start', async () => {
    const latest = latestSignal()
    const steps: string[] = []
    const gates: Array<() => void> = []
    const wait = () => new Promise<void>((resolve) => gates.push(resolve))
    const flow = async (name: string) => {
      const signal = latest.next()
      await wait()
      if (signal.aborted) return
      steps.push(`${name}:read`)
      await wait()
      if (signal.aborted) return
      steps.push(`${name}:commit`)
    }

    const older = flow('older')
    gates[0]()
    await Promise.resolve()
    const newer = flow('newer')
    gates[1]()
    gates[2]()
    await Promise.resolve()
    gates[3]()
    await Promise.all([older, newer])

    expect(steps).toEqual(['older:read', 'newer:read', 'newer:commit'])
  })

  it('cancels the current flow on abort without starting another', () => {
    const latest = latestSignal()
    const signal = latest.next()
    latest.abort()

    expect(signal.aborted).toBe(true)
    expect(latest.signal).toBe(signal)
  })
})
