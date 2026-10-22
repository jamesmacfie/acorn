import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ChannelClient, ChannelListeners } from '@acorn/channel/client.ts'
import { ChannelFailure, IdentityMismatchError } from '@acorn/channel/errors.ts'
import type { NodeStatus } from '@acorn/protocol/broker.ts'
import { AccountError } from './accountError'
import { createNodeLink, NodeOfflineError, type LinkHooks } from './nodeLink'

// One Node's link, with the channel standing in as a script: what the link does when a channel opens,
// answers, drops, or can't be opened, and what it refuses to retry.

type FakeChannel = ChannelClient & {
  listeners: ChannelListeners
  end(): void
  requests: { path: string; headers: Record<string, string> }[]
  frames: string[]
  answers: { status: number }[]
  eventsAnswer: boolean
}

function fakeChannel(listeners: ChannelListeners): FakeChannel {
  let end!: () => void
  const closed = new Promise<void>((resolve) => (end = resolve))
  const channel: FakeChannel = {
    listeners,
    requests: [],
    frames: [],
    answers: [{ status: 200 }],
    eventsAnswer: true,
    end,
    closed,
    request: async (request) => {
      channel.requests.push(request)
      return { ...(channel.answers.shift() ?? { status: 200 }), headers: {}, body: new Uint8Array() }
    },
    openEvents: async () => channel.eventsAnswer,
    sendFrame: (json) => void channel.frames.push(json),
    close: () => end(),
  }
  return channel
}

let channels: FakeChannel[]
let statuses: NodeStatus[]
let frames: unknown[]
let openFails: Error[]
let signedOut: LinkHooks['signedOut'] & ReturnType<typeof vi.fn>
let hooks: LinkHooks

beforeEach(() => {
  vi.useFakeTimers()
  channels = []
  statuses = []
  frames = []
  openFails = []
  signedOut = vi.fn() as typeof signedOut
  hooks = {
    open: async (listeners) => {
      const failure = openFails.shift()
      if (failure) throw failure
      const channel = fakeChannel(listeners)
      channels.push(channel)
      return channel
    },
    token: async () => 'acorn_dt_token',
    report: (status) => statuses.push(status),
    frame: (frame) => frames.push(frame),
    bytes: () => {},
    signedOut,
  }
})
afterEach(() => vi.useRealTimers())

const settle = () => vi.advanceTimersByTimeAsync(0)
const lastState = () => statuses.at(-1)?.state

describe('a Node link', () => {
  it('opens a channel when something asks, reports it online, and sends the token with the request', async () => {
    const link = createNodeLink('node-1', hooks)
    const answer = link.request({
      method: 'GET',
      path: '/v1/core/projects',
      headers: { authorization: 'Bearer wrong' },
    })
    await settle()
    expect(lastState()).toBe('online')
    expect((await answer).status).toBe(200)
    expect(channels[0]!.requests[0]).toMatchObject({
      path: '/v1/core/projects',
      headers: { authorization: 'Bearer acorn_dt_token' },
    })
  })

  it('fails a request as offline when no channel opens in time', async () => {
    openFails.push(...Array.from({ length: 20 }, () => new Error('relay down')))
    const link = createNodeLink('node-1', hooks)
    const answer = link.request({ method: 'GET', path: '/v1/node', headers: {} }).catch((error) => error)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await answer).toBeInstanceOf(NodeOfflineError)
    link.stop()
  })

  it('opens another channel with backoff when one drops, and reports each change', async () => {
    const link = createNodeLink('node-1', hooks)
    link.start()
    await settle()
    channels[0]!.end()
    await settle()
    expect(lastState()).toBe('offline')
    expect(statuses.at(-1)?.error).toEqual({ code: 'unreachable' })
    await vi.advanceTimersByTimeAsync(250)
    expect(channels).toHaveLength(2)
    expect(lastState()).toBe('online')
    link.stop()
  })

  it('waits longer each time a channel can’t be opened, up to five seconds', async () => {
    openFails.push(new Error('1'), new Error('2'), new Error('3'), new Error('4'), new Error('5'), new Error('6'))
    const link = createNodeLink('node-1', hooks)
    link.start()
    await settle()
    for (const wait of [250, 500, 1000, 2000, 4000, 5000]) {
      expect(channels).toHaveLength(0)
      await vi.advanceTimersByTimeAsync(wait)
    }
    expect(channels).toHaveLength(1)
    link.stop()
  })

  describe('the event feed', () => {
    it('opens with the token for the Node on screen, and drops frames when it isn’t wanted', async () => {
      const link = createNodeLink('node-1', hooks)
      channels.length = 0
      link.setEvents(true)
      await settle()
      channels[0]!.listeners.onFrame('{"channel":"term:status","seq":1}')
      expect(frames).toEqual([{ channel: 'term:status', seq: 1 }])
      link.stop()
    })

    it('holds client frames until the feed is open, then sends them in order', async () => {
      const link = createNodeLink('node-1', hooks)
      link.sendFrame('{"channel":"a"}')
      link.sendFrame('{"channel":"b"}')
      link.setEvents(true)
      await settle()
      expect(channels[0]!.frames).toEqual(['{"channel":"a"}', '{"channel":"b"}'])
      link.sendFrame('{"channel":"c"}')
      expect(channels[0]!.frames.at(-1)).toBe('{"channel":"c"}')
      link.stop()
    })

    it('reads a refused token as this phone being signed out of the Node, and stops', async () => {
      hooks.open = async (listeners) => {
        const channel = fakeChannel(listeners)
        channel.eventsAnswer = false
        channels.push(channel)
        return channel
      }
      const link = createNodeLink('node-1', hooks)
      link.setEvents(true)
      await settle()
      expect(statuses.at(-1)).toMatchObject({ state: 'revoked', error: { code: 'unauthorized' } })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(channels).toHaveLength(1)
    })

    it('opens a new channel when frames are missing, and not when the Node says it shed some', async () => {
      const link = createNodeLink('node-1', hooks)
      link.setEvents(true)
      await settle()
      const { onFrame } = channels[0]!.listeners
      onFrame('{"channel":"a","seq":1}')
      onFrame('{"channel":"b","seq":2}')
      onFrame('{"channel":"ws:shed","seq":5}')
      expect(frames).toHaveLength(3)
      expect(channels).toHaveLength(1)
      onFrame('{"channel":"c","seq":9}')
      await vi.advanceTimersByTimeAsync(300)
      expect(channels).toHaveLength(2)
      link.stop()
    })
  })

  describe('what it gives up on', () => {
    it('a Node that isn’t the pinned one', async () => {
      openFails.push(new IdentityMismatchError())
      const link = createNodeLink('node-1', hooks)
      link.start()
      await settle()
      expect(statuses.at(-1)).toMatchObject({ state: 'offline', error: { code: 'identity_mismatch' } })
      await vi.advanceTimersByTimeAsync(60_000)
      expect(channels).toHaveLength(0)
      await expect(link.request({ method: 'GET', path: '/v1/node', headers: {} })).rejects.toBeInstanceOf(
        NodeOfflineError,
      )
    })

    it('a person who is signed out of the account', async () => {
      openFails.push(new AccountError(401, 'invalid_token'))
      const link = createNodeLink('node-1', hooks)
      link.start()
      await settle()
      expect(signedOut).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(60_000)
      expect(channels).toHaveLength(0)
    })

    it('a Node the account no longer lists', async () => {
      openFails.push(new AccountError(404, 'not_found'))
      const link = createNodeLink('node-1', hooks)
      link.start()
      await settle()
      expect(lastState()).toBe('offline')
      await vi.advanceTimersByTimeAsync(60_000)
      expect(channels).toHaveLength(0)
      expect(signedOut).not.toHaveBeenCalled()
    })

    it('a token the Node’s router refuses', async () => {
      const link = createNodeLink('node-1', hooks)
      const first = link.request({ method: 'GET', path: '/v1/core/tasks', headers: {} })
      await settle()
      channels[0]!.answers = [{ status: 401 }]
      const second = await link.request({ method: 'GET', path: '/v1/core/tasks', headers: {} })
      expect(second.status).toBe(401)
      expect(statuses.at(-1)).toMatchObject({ state: 'revoked', error: { code: 'unauthorized' } })
      await first
    })

    it('a Node with no token on this phone', async () => {
      hooks.token = async () => null
      const link = createNodeLink('node-1', hooks)
      link.start()
      await settle()
      expect(statuses.at(-1)).toMatchObject({ state: 'revoked' })
      expect(channels).toHaveLength(0)
    })
  })

  it('replaces the channel when it is restarted, and lets the old one go', async () => {
    const link = createNodeLink('node-1', hooks)
    link.setEvents(true)
    await settle()
    link.restart()
    await settle()
    expect(channels).toHaveLength(2)
    // The first channel closing must not start a third.
    await vi.advanceTimersByTimeAsync(10_000)
    expect(channels).toHaveLength(2)
    expect(lastState()).toBe('online')
    link.stop()
  })

  it('closes the channel of a Node nobody is looking at once it has been idle for a while', async () => {
    const link = createNodeLink('node-1', hooks)
    await link.request({ method: 'GET', path: '/v1/core/tasks', headers: {} }).catch(() => {})
    await settle()
    link.setEvents(false)
    await vi.advanceTimersByTimeAsync(31_000)
    await expect(channels[0]!.closed).resolves.toBeUndefined()
  })

  it('turns a request the channel failed into the channel’s own error', async () => {
    const link = createNodeLink('node-1', hooks)
    link.start()
    await settle()
    channels[0]!.request = async () => {
      throw new ChannelFailure('unreachable', 'The Node couldn’t answer.')
    }
    await expect(link.request({ method: 'GET', path: '/v1/x', headers: {} })).rejects.toBeInstanceOf(ChannelFailure)
  })
})
