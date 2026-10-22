import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AccountNode } from '@acorn/protocol/account.ts'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'

const saved = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('./pairedNodes', () => ({ savePaired: async (...args: unknown[]) => void saved.calls.push(args) }))
vi.mock('./account', () => ({ fetchAssertion: async () => 'assertion.jwt' }))

type Request = { method: string; path: string; headers: Record<string, string>; body?: Uint8Array }
const channel = vi.hoisted(() => ({
  requests: [] as { path: string; body: unknown }[],
  // What the Node answers, by path. A list is answered in order.
  answers: {} as Record<string, { status: number; body: unknown }[]>,
  closed: 0,
}))
vi.mock('./openChannel', () => ({
  openNodeChannel: async () => ({
    close: () => void channel.closed++,
    request: async (request: Request) => {
      channel.requests.push({ path: request.path, body: JSON.parse(new TextDecoder().decode(request.body)) })
      const answer = channel.answers[request.path]!.shift()!
      return { status: answer.status, headers: {}, body: new TextEncoder().encode(JSON.stringify(answer.body)) }
    },
  }),
}))

import { pairWithNode, phoneName } from './pairing'

const NODE: AccountNode = {
  nodeId: '7f3c9c1e-5b2a-4d1e-9f77-2a5c8d0b1e44',
  label: 'Studio',
  fingerprint: 'ab'.repeat(32),
  channelKey: 'cd'.repeat(32),
  relayUrl: 'wss://relay.test',
}
const ask = { secret: 's3cret', phrase: 'engine fjord cherry', expiresInMs: 120_000 }
const paired = { baseline: ACORN_BASELINE, deviceToken: 'acorn_dt_new', nodeId: NODE.nodeId, device: { id: 'd1' } }

beforeEach(() => {
  vi.useFakeTimers()
  saved.calls.length = 0
  channel.requests.length = 0
  channel.closed = 0
  channel.answers = {}
})

describe('pairing this phone with a Node', () => {
  it('asks with the account’s assertion, shows the words, and keeps the token once a device allows it', async () => {
    channel.answers['/v1/pair/requests'] = [{ status: 200, body: ask }]
    channel.answers['/v1/pair/requests/claim'] = [
      { status: 202, body: { status: 'pending' } },
      { status: 200, body: paired },
    ]
    const pairing = await pairWithNode(NODE, 'iPhone Safari 1a2b')
    expect(pairing.phrase).toBe('engine fjord cherry')
    expect(channel.requests[0]).toEqual({
      path: '/v1/pair/requests',
      body: { deviceName: 'iPhone Safari 1a2b', assertion: 'assertion.jwt' },
    })
    const done = pairing.paired
    await vi.advanceTimersByTimeAsync(1_500)
    await expect(done).resolves.toMatchObject({ nodeId: NODE.nodeId, label: 'Studio', channelKey: NODE.channelKey })
    expect(channel.requests.at(-1)).toEqual({ path: '/v1/pair/requests/claim', body: { secret: 's3cret' } })
    expect(saved.calls).toEqual([
      [expect.objectContaining({ nodeId: NODE.nodeId, channelKey: NODE.channelKey }), 'acorn_dt_new'],
    ])
    expect(channel.closed).toBe(1)
  })

  it('pins the key the account listed, and refuses to pair with a Node that listed none', async () => {
    await expect(pairWithNode({ ...NODE, channelKey: undefined })).rejects.toThrow('Turn Remote access off and on')
    expect(channel.requests).toEqual([])
  })

  it('says why the Node refused the ask, and closes the channel', async () => {
    channel.answers['/v1/pair/requests'] = [{ status: 403, body: {} }]
    await expect(pairWithNode(NODE)).rejects.toThrow('only takes a pairing request from the account that owns it')
    expect(channel.closed).toBe(1)
  })

  it('fails when the request is denied or runs out', async () => {
    channel.answers['/v1/pair/requests'] = [{ status: 200, body: ask }]
    channel.answers['/v1/pair/requests/claim'] = [{ status: 401, body: {} }]
    const pairing = await pairWithNode(NODE)
    await expect(pairing.paired).rejects.toThrow('denied, or it ran out of time')
    expect(saved.calls).toEqual([])
    expect(channel.closed).toBe(1)
  })

  it('stops asking when cancelled', async () => {
    channel.answers['/v1/pair/requests'] = [{ status: 200, body: ask }]
    channel.answers['/v1/pair/requests/claim'] = [{ status: 202, body: { status: 'pending' } }]
    const pairing = await pairWithNode(NODE)
    const outcome = pairing.paired.catch((error: Error) => error.message)
    await vi.advanceTimersByTimeAsync(0)
    pairing.cancel()
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await outcome).toBe('Cancelled.')
    expect(saved.calls).toEqual([])
  })

  it('refuses a Node that speaks another baseline', async () => {
    channel.answers['/v1/pair/requests'] = [{ status: 200, body: ask }]
    channel.answers['/v1/pair/requests/claim'] = [{ status: 200, body: { ...paired, baseline: 'acorn-9' } }]
    const pairing = await pairWithNode(NODE)
    await expect(pairing.paired).rejects.toThrow('version of Acorn')
    expect(saved.calls).toEqual([])
  })
})

describe('the name a phone gives itself', () => {
  it.each([
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1',
      /^iPhone Safari [0-9a-f]{4}$/,
    ],
    [
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      /^Android Chrome [0-9a-f]{4}$/,
    ],
    ['Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0', /^Android Firefox [0-9a-f]{4}$/],
  ])('reads %s', (userAgent, expected) => {
    expect(phoneName(userAgent)).toMatch(expected)
  })
})
