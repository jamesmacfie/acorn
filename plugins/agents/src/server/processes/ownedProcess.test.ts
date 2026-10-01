import { afterEach, describe, expect, it, vi } from 'vitest'
import { OwnedProcess, ProcessRetirementError } from './ownedProcess'

describe('owned process exit acknowledgement', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

  it.each([false, true])('treats an inaccessible group as still present (persistent: %s)', async (persistent) => {
    vi.useFakeTimers()
    let exited!: () => void
    let inaccessible = true
    vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal !== 0) { exited(); return true }
      const code = inaccessible ? 'EPERM' : 'ESRCH'
      if (!persistent) inaccessible = false
      throw Object.assign(new Error(code), { code })
    })
    const owner = new OwnedProcess(123, (done) => { exited = done }, () => {})
    const stopping = owner.stop()
    const outcome = persistent
      ? expect(stopping).rejects.toBeInstanceOf(ProcessRetirementError)
      : expect(stopping).resolves.toBeUndefined()
    await vi.advanceTimersByTimeAsync(4_020)
    await outcome
    expect(vi.getTimerCount()).toBe(0)
  })
})
