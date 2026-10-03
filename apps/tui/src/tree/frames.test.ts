import { afterEach, describe, expect, it, vi } from 'vitest'
import { frameRequested, framesSettled, holdFrame, onFrame } from './frames'

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve))

afterEach(() => onFrame(null))

describe('frame holds', () => {
  it('keeps a replacement surface held when the old surface releases late', async () => {
    const releaseOld = holdFrame()
    onFrame(null)
    const draw = vi.fn()
    onFrame(draw)
    const releaseCurrent = holdFrame()
    try {
      releaseOld()
      await nextTurn()
      expect(draw).not.toHaveBeenCalled()
      expect(frameRequested()).toBe(true)
    } finally {
      releaseCurrent()
      await nextTurn()
    }
    await expect(framesSettled()).resolves.toBeUndefined()
    expect(draw).toHaveBeenCalledOnce()
    releaseOld()
    releaseCurrent()
    expect(frameRequested()).toBe(false)
  })

  it('settles after a normal release without letting a duplicate release consume another hold', async () => {
    const draw = vi.fn()
    onFrame(draw)
    const first = holdFrame()
    const second = holdFrame()
    first()
    first()
    await nextTurn()
    expect(frameRequested()).toBe(true)
    const settled = framesSettled()
    second()
    await expect(settled).resolves.toBeUndefined()
    await nextTurn()
    expect(draw).toHaveBeenCalledTimes(2)
    expect(frameRequested()).toBe(false)
  })

  it('reports a genuinely lost hold', async () => {
    holdFrame()
    await expect(framesSettled()).rejects.toThrow('TUI frame hold was not released within 200 ms (1 held)')
  })
})
