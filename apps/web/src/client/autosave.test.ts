import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { debounce } from './autosave'

describe('debounce', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('fires once after the quiet window, with the latest args', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('a')
    d('b')
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledExactlyOnceWith('b')
  })

  it('flush() runs the pending call immediately and only once', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d('x')
    d.flush()
    expect(fn).toHaveBeenCalledExactlyOnceWith('x')
    vi.advanceTimersByTime(200) // no double-fire from the cleared timer
    expect(fn).toHaveBeenCalledOnce()
  })

  it('flush() with nothing pending is a no-op; cancel() drops the pending call', () => {
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d.flush()
    expect(fn).not.toHaveBeenCalled()
    d('y')
    d.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).not.toHaveBeenCalled()
  })
})
