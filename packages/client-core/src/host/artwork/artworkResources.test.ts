import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { jpegBytes, pngBytes } from './artworkFixtures.helper'

type Answer = { bytes: Uint8Array; type: string }
const pending: { path: string; nodeId: string; signal: AbortSignal; resolve(answer: Answer): void; reject(): void }[] =
  []
const readBytes = vi.fn(
  (path: string, _fallback: string, options: { nodeId: string; signal: AbortSignal }) =>
    new Promise<Answer>((resolve, reject) => {
      pending.push({
        path,
        nodeId: options.nodeId,
        signal: options.signal,
        resolve,
        reject: () => reject(new Error('404')),
      })
      options.signal.addEventListener('abort', () => reject(new Error('aborted')))
    }),
)
vi.mock('../../infra/node/apiClient', () => ({ readBytes }))
const warn = vi.fn()
vi.mock('../../infra/telemetry/logger', () => ({ createLogger: () => ({ warn }) }))

const { acquireArtwork } = await import('./artworkResources')

const owner = { nodeId: 'node-a', pluginId: 'music' }
const cover = (revision: string) => ({ path: `/v1/p/music/art/${revision}`, revision })
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  pending.length = 0
  readBytes.mockClear()
  warn.mockClear()
})
afterEach(async () => {
  await settle()
})

describe('artwork resources', () => {
  it('shares one read per Node, plugin, path and revision, and revokes its URL after the last release', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const first = acquireArtwork(owner, cover('1'))
    const second = acquireArtwork(owner, cover('1'))
    const elsewhere = acquireArtwork({ ...owner, nodeId: 'node-b' }, cover('1'))
    expect(second).toBe(first)
    expect(elsewhere).not.toBe(first)
    expect(pending.map((read) => [read.nodeId, read.path])).toEqual([
      ['node-a', '/v1/p/music/art/1'],
      ['node-b', '/v1/p/music/art/1'],
    ])
    pending[0].resolve({ bytes: pngBytes(), type: 'image/png' })
    await settle()
    expect(first.status()).toBe('ready')
    const url = first.url()
    expect(url).toMatch(/^blob:/)

    first.release()
    await settle()
    expect(revoke).not.toHaveBeenCalled()
    second.release()
    await settle()
    expect(revoke).toHaveBeenCalledWith(url)
    elsewhere.release()
    await settle()
    expect(pending[1].signal.aborted).toBe(true)
  })

  it('reads at most four pictures at once', async () => {
    const held = ['1', '2', '3', '4', '5'].map((revision) => acquireArtwork(owner, cover(revision)))
    expect(pending).toHaveLength(4)
    expect(held[4].status()).toBe('loading')
    pending[0].resolve({ bytes: pngBytes(), type: 'image/png' })
    await settle()
    expect(pending).toHaveLength(5)
    for (const resource of held) resource.release()
  })

  it('refuses a foreign route, a mismatched type, and an animation without reading or drawing them', async () => {
    const foreign = acquireArtwork(owner, { path: '/v1/p/other/art/1', revision: '1' })
    const escaping = acquireArtwork(owner, { path: '/v1/p/music/../other/art', revision: '1' })
    expect(foreign.status()).toBe('failed')
    expect(escaping.status()).toBe('failed')
    expect(readBytes).not.toHaveBeenCalled()

    const mislabelled = acquireArtwork(owner, cover('jpeg'))
    const animated = acquireArtwork(owner, cover('apng'))
    pending[0].resolve({ bytes: jpegBytes(), type: 'image/png' })
    pending[1].resolve({ bytes: pngBytes(64, 64, { animated: true }), type: 'image/png' })
    await settle()
    expect(mislabelled.status()).toBe('failed')
    expect(animated.status()).toBe('failed')
    expect(mislabelled.url()).toBeUndefined()
    // The category and the plugin, never the path.
    expect(warn.mock.calls.map((call) => call[0])).toEqual([
      'music artwork could not be shown (route)',
      'music artwork could not be shown (route)',
      'music artwork could not be shown (type)',
      'music artwork could not be shown (animated)',
    ])
    for (const resource of [foreign, escaping, mislabelled, animated]) resource.release()
  })

  it('draws a fallback while the memory ceiling is full and reads once a release makes room', async () => {
    const big = new Uint8Array(4 * 1024 * 1024)
    big.set(pngBytes())
    const resident = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((revision) => acquireArtwork(owner, cover(revision)))
    for (let index = 0; index < resident.length; index++) {
      pending[index].resolve({ bytes: big, type: 'image/png' })
      await settle()
    }
    expect(resident.every((resource) => resource.status() === 'ready')).toBe(true)
    // Seven resident pictures hold 28 MiB, and one more read could bring 5.
    const waiting = acquireArtwork(owner, cover('h'))
    expect(waiting.status()).toBe('deferred')
    expect(pending).toHaveLength(7)

    resident[0].release()
    await settle()
    expect(waiting.status()).toBe('loading')
    expect(pending).toHaveLength(8)
    for (const resource of [...resident.slice(1), waiting]) resource.release()
  })
})
