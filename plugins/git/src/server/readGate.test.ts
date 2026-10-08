import { expect, it } from 'vitest'
import { readGate } from './readGate'

it('caps concurrent reads and releases a queued read after an abort', async () => {
  const limited = readGate()
  const started: number[] = []
  const finish: Array<() => void> = []
  const read = (id: number, signal = new AbortController().signal) => limited(signal, async () => {
    started.push(id)
    await new Promise<void>((resolve) => finish.push(resolve))
    return id
  })
  const first = read(1)
  const second = read(2)
  const controller = new AbortController()
  const cancelled = read(3, controller.signal).catch(() => -1)
  const fourth = read(4)
  expect(started).toEqual([1, 2])
  controller.abort()
  expect(await cancelled).toBe(-1)
  finish.shift()?.()
  expect(await first).toBe(1)
  expect(started).toEqual([1, 2, 4])
  finish.shift()?.()
  finish.shift()?.()
  expect(await Promise.all([second, fourth])).toEqual([2, 4])
})
