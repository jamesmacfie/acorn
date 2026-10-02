import { describe, expect, it, vi } from 'vitest'
import { createPluginStartup } from './pluginStartup'

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

const setup = () => {
  let active = 'A'
  const plugins = [{ name: 'changes', init: () => {} }]
  const load = vi.fn(async () => plugins)
  const register = vi.fn()
  const refresh = vi.fn(async (_nodeId: string): Promise<readonly string[] | null> => [])
  const onReady = vi.fn()
  const startup = createPluginStartup({ load, register, refresh, onReady, activeNode: () => active, disabled: () => [] })
  return { ...startup, plugins, load, register, refresh, onReady, select: (id: string) => { active = id } }
}

describe('post-paint compiled plugin startup', () => {
  it('waits for the host to release startup, loads once, and deduplicates node application', async () => {
    const host = setup()
    const first = host.apply('A')
    const second = host.apply('A')
    expect(second).toBe(first)
    await Promise.resolve()
    expect(host.load).not.toHaveBeenCalled()
    expect(host.refresh).not.toHaveBeenCalled()

    await Promise.all([host.initialize(), host.initialize(), first])
    expect(host.load).toHaveBeenCalledTimes(1)
    expect(host.refresh).toHaveBeenCalledTimes(1)
    expect(host.onReady).toHaveBeenCalledTimes(1)
    expect(host.register).toHaveBeenCalledWith(host.plugins, [])
    await host.apply('A')
    expect(host.refresh).toHaveBeenCalledTimes(1)
  })

  it('discards a response for a node that was switched away from', async () => {
    const host = setup()
    const old = deferred<readonly string[]>()
    const requested = deferred<void>()
    host.refresh.mockImplementation(async (id) => {
      if (id === 'A') { requested.resolve(); return await old.promise }
      return ['docker']
    })
    await host.initialize()
    const a = host.apply('A')
    await requested.promise
    host.select('B')
    await host.apply('B')
    old.resolve(['changes'])
    await a
    expect(host.register.mock.calls.map(([, disabled]) => disabled)).toEqual([[], ['docker']])
  })

  it('retries an unanswered roster and reapplies a node after switching back', async () => {
    const host = setup()
    host.refresh.mockResolvedValueOnce(['changes']).mockResolvedValueOnce(null).mockResolvedValueOnce(['changes'])
    await host.initialize()
    await host.apply('A')
    host.select('B')
    await host.apply('B')
    host.select('A')
    await host.apply('A')
    expect(host.refresh.mock.calls.map(([id]) => id)).toEqual(['A', 'B', 'A'])
    expect(host.register).toHaveBeenLastCalledWith(host.plugins, ['changes'])

    host.select('B')
    host.refresh.mockResolvedValueOnce(null).mockResolvedValueOnce(['docker'])
    await host.apply('B')
    await host.apply('B')
    expect(host.register).toHaveBeenLastCalledWith(host.plugins, ['docker'])
  })

  it('does not release restoration when registration fails', async () => {
    const host = setup()
    host.register.mockImplementation(() => { throw new Error('duplicate pane') })
    const apply = host.apply('A')
    await expect(host.initialize()).rejects.toThrow('duplicate pane')
    await expect(apply).rejects.toThrow('duplicate pane')
    expect(host.onReady).not.toHaveBeenCalled()
    expect(host.refresh).not.toHaveBeenCalled()
  })
})
