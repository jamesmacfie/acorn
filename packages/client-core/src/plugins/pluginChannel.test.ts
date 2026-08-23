import { afterEach, describe, expect, it, vi } from 'vitest'
import { _resetPluginChannels, ensurePluginChannel, onPluginFrame, onPluginPush } from './pluginChannel'
import { routeWsFrame, wsChannelPrefixes } from '../wsChannels'

// The prefix core claims for every loaded plugin's live channel (docs/plugins.md § The live channel).
// A subscribed frame gets every frame, chrome gets a coalesced nudge.
//
// `wsClient` is stubbed because `wsConnect()` would open a socket from a unit test.
vi.mock('../wsClient', () => ({ wsConnect: () => {} }))

afterEach(() => {
  _resetPluginChannels()
  vi.useRealTimers()
})

describe('the claim', () => {
  it('takes the prefix once, however many subscribers arrive', () => {
    ensurePluginChannel()
    ensurePluginChannel()
    const stop = onPluginPush(() => {})
    expect(wsChannelPrefixes()).toContain('plugin')
    stop()
  })
})

describe('frame delivery', () => {
  it('hands a frame to the plugin that owns the channel and to no one else', () => {
    const board: unknown[] = []
    const other: unknown[] = []
    onPluginFrame('board', 'plugin:board:sample', (payload) => board.push(payload))
    onPluginFrame('other', 'plugin:other:sample', (payload) => other.push(payload))
    routeWsFrame({ channel: 'plugin:board:sample', cpu: 1 })
    expect(board).toEqual([{ cpu: 1 }])
    expect(other).toEqual([])
  })

  it('delivers every frame, uncoalesced', () => {
    const seen: unknown[] = []
    onPluginFrame('board', 'plugin:board:sample', (payload) => seen.push(payload))
    for (const cpu of [1, 2, 3]) routeWsFrame({ channel: 'plugin:board:sample', cpu })
    expect(seen).toEqual([{ cpu: 1 }, { cpu: 2 }, { cpu: 3 }])
  })

  it('keeps two verbs of one plugin apart', () => {
    const samples: unknown[] = []
    const alerts: unknown[] = []
    onPluginFrame('board', 'plugin:board:sample', (payload) => samples.push(payload))
    onPluginFrame('board', 'plugin:board:alert', (payload) => alerts.push(payload))
    routeWsFrame({ channel: 'plugin:board:alert', level: 'warn' })
    expect(samples).toEqual([])
    expect(alerts).toEqual([{ level: 'warn' }])
  })

  it('refuses a channel belonging to another plugin, and one that is not a channel', () => {
    expect(() => onPluginFrame('board', 'plugin:other:sample', () => {})).toThrow(/belongs to 'other'/)
    expect(() => onPluginFrame('board', 'runtime:task-archived', () => {})).toThrow(/not a plugin channel/)
    // Three colons parse as neither: a verb cannot hold the delimiter.
    expect(() => onPluginFrame('board', 'plugin:board:a:b', () => {})).toThrow(/not a plugin channel/)
  })

  it('drops a malformed frame on its own prefix rather than guessing', () => {
    const seen: unknown[] = []
    onPluginFrame('board', 'plugin:board:sample', (payload) => seen.push(payload))
    routeWsFrame({ channel: 'plugin:board' })
    routeWsFrame({ channel: 'plugin:Board:sample' })
    expect(seen).toEqual([])
  })
})

describe('chrome coalescing', () => {
  it('announces the first push immediately and folds a burst into one more', () => {
    vi.useFakeTimers()
    const seen: string[] = []
    onPluginPush((pluginId) => seen.push(pluginId))
    for (let i = 0; i < 20; i++) routeWsFrame({ channel: 'plugin:board:sample', i })
    // Leading edge only, so far: the other nineteen are still owed one trailing announcement.
    expect(seen).toEqual(['board'])
    vi.advanceTimersByTime(500)
    expect(seen).toEqual(['board', 'board'])
    // And nothing more, however long the burst was.
    vi.advanceTimersByTime(5_000)
    expect(seen).toEqual(['board', 'board'])
  })

  it('bumps only the plugin that pushed', () => {
    const seen: string[] = []
    onPluginPush((pluginId) => seen.push(pluginId))
    routeWsFrame({ channel: 'plugin:board:sample' })
    expect(seen).toEqual(['board'])
  })

  it('coalesces per plugin rather than globally', () => {
    vi.useFakeTimers()
    const seen: string[] = []
    onPluginPush((pluginId) => seen.push(pluginId))
    routeWsFrame({ channel: 'plugin:board:sample' })
    routeWsFrame({ channel: 'plugin:other:sample' })
    // Two plugins, two leading edges: one plugin's cadence must not delay another's first update.
    expect(seen).toEqual(['board', 'other'])
    vi.advanceTimersByTime(500)
    expect(seen).toEqual(['board', 'other'])
  })

  it('stops announcing after the last listener leaves', () => {
    const seen: string[] = []
    const stop = onPluginPush((pluginId) => seen.push(pluginId))
    stop()
    routeWsFrame({ channel: 'plugin:board:sample' })
    expect(seen).toEqual([])
  })
})
