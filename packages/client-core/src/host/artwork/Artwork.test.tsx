import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TreeMutation } from '@acorn/protocol/tree/messages.ts'
import { pngBytes } from './artworkFixtures.helper'

type Read = { path: string; nodeId: string; resolve(bytes: Uint8Array): void; reject(): void }
const reads: Read[] = []
vi.mock('../../infra/node/apiClient', async (original) => ({
  ...(await original<typeof import('../../infra/node/apiClient')>()),
  readBytes: (path: string, _fallback: string, options: { nodeId: string }) =>
    new Promise((resolve, reject) =>
      reads.push({
        path,
        nodeId: options.nodeId,
        resolve: (bytes) => resolve({ bytes, type: 'image/png', filename: null }),
        reject: () => reject(new Error('404')),
      }),
    ),
}))

const { Artwork } = await import('./Artwork')
const { TreeHost } = await import('../tree/TreeHost')

let host: HTMLElement
let dispose: (() => void) | undefined
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const owner = { nodeId: 'node-a', pluginId: 'music' }
const cover = (revision: string) => ({ path: `/v1/p/music/art/${revision}`, revision, alt: `Cover ${revision}` })
const box = () => host.querySelector<HTMLElement>('.ui-artwork')!
const img = () => box().querySelector('img')

beforeEach(() => {
  reads.length = 0
  host = document.createElement('div')
  document.body.append(host)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  dispose?.()
  dispose = undefined
  host.remove()
  vi.restoreAllMocks()
})

describe('Artwork', () => {
  it('holds its square with a placeholder while loading, then draws the checked picture', async () => {
    dispose = render(() => <Artwork image={cover('1')} owner={owner} preset="detail" fallback="Example album" />, host)
    expect(box().dataset.preset).toBe('detail')
    expect(box().textContent).toBe('')
    expect(reads.map((read) => [read.nodeId, read.path])).toEqual([['node-a', '/v1/p/music/art/1']])

    reads[0].resolve(pngBytes())
    await settle()
    expect(img()?.getAttribute('src')).toMatch(/^blob:/)
    expect(img()?.alt).toBe('Cover 1')
    // Hidden until the element itself has loaded those bytes.
    expect(box().dataset.drawn).toBeUndefined()
    img()!.dispatchEvent(new Event('load'))
    expect(box().dataset.drawn).toBe('true')
  })

  it('draws its fallback when the picture is missing, refused, or fails to decode', async () => {
    dispose = render(() => <Artwork image={cover('1')} owner={owner} fallback="Example album" />, host)
    reads[0].reject()
    await settle()
    expect(box().textContent).toBe('Example album')
    dispose()
    host.textContent = ''

    dispose = render(() => <Artwork fallback="No cover" />, host)
    expect(box().textContent).toBe('No cover')
    dispose()
    host.textContent = ''

    dispose = render(() => <Artwork image={cover('2')} owner={owner} fallback="Example album" />, host)
    reads[1].resolve(pngBytes())
    await settle()
    img()!.dispatchEvent(new Event('error'))
    expect(img()).toBeNull()
    expect(box().textContent).toBe('Example album')
  })

  it('draws the placeholder, not the previous cover, while the next one loads', async () => {
    const [image, setImage] = createSignal(cover('1'))
    dispose = render(() => <Artwork image={image()} owner={owner} icon="music" decorative />, host)
    reads[0].resolve(pngBytes())
    await settle()
    img()!.dispatchEvent(new Event('load'))
    expect(box().dataset.drawn).toBe('true')
    expect(img()?.getAttribute('aria-hidden')).toBe('true')

    setImage(cover('2'))
    expect(img()).toBeNull()
    expect(box().dataset.drawn).toBeUndefined()
    expect(box().querySelector('svg, .ui-icon')).not.toBeNull()
    reads[1].resolve(pngBytes())
    await settle()
    expect(box().dataset.drawn).toBeUndefined()
    img()!.dispatchEvent(new Event('load'))
    expect(box().dataset.drawn).toBe('true')
  })
})

describe('Artwork in a tree', () => {
  const mount = (nodeId?: string) => {
    const listeners: ((ops: readonly TreeMutation[]) => void)[] = []
    dispose = render(
      () => (
        <TreeHost
          pluginId="music"
          {...(nodeId ? { nodeId } : {})}
          transport={{
            onBatch: (listener) => (listeners.push(listener), () => {}),
            onFailed: () => () => {},
            send: () => {},
          }}
        />
      ),
      host,
    )
    return (props: Record<string, unknown>) => {
      for (const listener of listeners)
        listener([{ op: 'insert', parent: null, index: 0, node: { id: 'art', type: 'Artwork', props, children: [] } }])
    }
  }
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))

  it('reads from the mount’s own Node and plugin, whatever owner the tree sends', async () => {
    const send = mount('node-a')
    send({ image: cover('1'), owner: { nodeId: 'node-b', pluginId: 'other' }, fallback: 'Album' })
    await frame()
    expect(reads.map((read) => [read.nodeId, read.path])).toEqual([['node-a', '/v1/p/music/art/1']])
  })

  it('draws the fallback and reads nothing for a picture outside its plugin’s routes, or with no Node', async () => {
    const send = mount('node-a')
    send({ image: { path: '/v1/p/other/art/1', revision: '1', alt: '' }, fallback: 'Album' })
    await frame()
    await settle()
    expect(reads).toEqual([])
    expect(box().textContent).toBe('Album')
    dispose!()
    host.textContent = ''

    const unbound = mount()
    unbound({ image: cover('1'), fallback: 'Album' })
    await frame()
    expect(reads).toEqual([])
    expect(box().textContent).toBe('Album')
  })
})
