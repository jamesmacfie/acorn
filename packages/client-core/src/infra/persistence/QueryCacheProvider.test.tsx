import { createQuery, dehydrate, QueryClient, useIsRestoring } from '@tanstack/solid-query'
import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { QueryCacheProvider } from './QueryCacheProvider'
import { queryCacheLifecycle } from './queryCacheLifecycle'

const dispose: (() => void)[] = []
afterEach(() => { for (const stop of dispose.splice(0)) stop(); document.body.replaceChildren() })

describe('query cache provider restoration', () => {
  it('gates query requests until public restore and preserves the restore context', async () => {
    const seed = new QueryClient(); seed.setQueryData(['tasks'], ['cached'])
    let read!: (value: string) => void
    const client = new QueryClient()
    const persistence = queryCacheLifecycle({ client, key: 'host', storage: {
      getItem: () => new Promise((resolve) => { read = resolve }), setItem: async () => {}, removeItem: async () => {},
    }, onError: vi.fn() })
    let answer!: (rows: string[]) => void
    const request = vi.fn(() => new Promise<string[]>((resolve) => { answer = resolve }))
    const Consumer = () => {
      const restoring = useIsRestoring()
      const query = createQuery(() => ({ queryKey: ['tasks'], queryFn: request }))
      return <div>{restoring() ? 'restoring' : query.data?.join(',')}</div>
    }
    const container = document.createElement('main'); document.body.append(container)
    const unmount = render(() => <QueryCacheProvider cache={{ client, persistence, persister: persistence.persister, hydrated: () => {} }}><Consumer /></QueryCacheProvider>, container)
    dispose.push(unmount)
    await vi.waitFor(() => expect(read).toBeTypeOf('function'))
    expect(container.textContent).toBe('restoring')
    expect(request).not.toHaveBeenCalled()
    read(JSON.stringify({ buster: '', timestamp: Date.now(), clientState: dehydrate(seed) }))
    await vi.waitFor(() => expect(container.textContent).toBe('cached'))
    expect(request).toHaveBeenCalledTimes(1)
    answer(['fresh'])
    await vi.waitFor(() => expect(container.textContent).toBe('fresh'))
    expect(request).toHaveBeenCalledTimes(1)
    unmount(); dispose.pop()
    await persistence.retire()
  })

  it('releases an unmounted restoring provider without late publication or an idle persistence subscription', async () => {
    const seed = new QueryClient(); seed.setQueryData(['tasks'], ['cached'])
    let read!: (value: string) => void
    const client = new QueryClient(), write = vi.fn(async () => {})
    const persistence = queryCacheLifecycle({ client, key: 'unmounted', storage: {
      getItem: () => new Promise((resolve) => { read = resolve }), setItem: write, removeItem: async () => {},
    }, onError: vi.fn(), captureWindowMs: 0 })
    const request = vi.fn(async () => ['fresh'])
    const Consumer = () => { const query = createQuery(() => ({ queryKey: ['tasks'], queryFn: request })); return <div>{query.data?.join(',')}</div> }
    const container = document.createElement('main'); document.body.append(container)
    const unmount = render(() => <QueryCacheProvider cache={{ client, persistence, persister: persistence.persister, hydrated: () => {} }}><Consumer /></QueryCacheProvider>, container)
    await vi.waitFor(() => expect(read).toBeTypeOf('function'))
    unmount()
    read(JSON.stringify({ buster: '', timestamp: Date.now(), clientState: dehydrate(seed) }))
    await vi.waitFor(() => expect(client.getQueryData(['tasks'])).toEqual(['cached']))
    expect(container.textContent).toBe('')
    expect(request).not.toHaveBeenCalled()
    client.setQueryData(['tasks'], ['inactive update'])
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(write).not.toHaveBeenCalled()
    await persistence.retire()
  })

  it('does not publish a delayed read into a retired provider', async () => {
    const seed = new QueryClient(); seed.setQueryData(['tasks'], ['retired'])
    let read!: (value: string) => void
    const client = new QueryClient()
    const persistence = queryCacheLifecycle({ client, key: 'retired', storage: {
      getItem: () => new Promise((resolve) => { read = resolve }), setItem: async () => {}, removeItem: async () => {},
    }, onError: vi.fn() })
    const Consumer = () => { const restoring = useIsRestoring(); return <div>{restoring() ? 'restoring' : 'published'}</div> }
    const container = document.createElement('main'); document.body.append(container)
    dispose.push(render(() => <QueryCacheProvider cache={{ client, persistence, persister: persistence.persister, hydrated: () => {} }}><Consumer /></QueryCacheProvider>, container))
    await vi.waitFor(() => expect(read).toBeTypeOf('function'))
    await persistence.retire()
    read(JSON.stringify({ buster: '', timestamp: Date.now(), clientState: dehydrate(seed) }))
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(client.getQueryData(['tasks'])).toBeUndefined()
    expect(container.textContent).toBe('restoring')
  })
})
