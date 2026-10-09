import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { Env } from '../bindings'
import { createApp } from '../index'
import type { AppEnv } from '../middleware/auth'
import { ownerId } from '../middleware/requireUser'
import { registerRoute, removePluginRoutes } from '../routes/registry'
import { LazyRouteLoadError, lazyFetch, lazyRouter } from './lazyRoutes'
import type { PluginFetchHandler, PluginRequestContext } from './types'

// Enough of an Env for authMiddleware to resolve a device principal (pluginFetchRoute.test.ts).
const ENV = {
  DEVICES: { authenticate: async () => ({ deviceId: 'd1' }) },
  ACTIVE_IDENTITY: { get: () => 'james' },
} as unknown as Env

const call = (path: string, init?: RequestInit) =>
  createApp().fetch(new Request(`http://127.0.0.1:4317${path}`, { headers: { authorization: 'Bearer d' }, ...init }), ENV)

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

afterEach(() => removePluginRoutes('lazy'))

describe('lazyFetch', () => {
  const context = { userId: 'james' } as PluginRequestContext

  it('builds one handler for concurrent first requests', async () => {
    const loaded = deferred<PluginFetchHandler>()
    const load = vi.fn(() => loaded.promise)
    const handler = lazyFetch(load)
    const first = handler(new Request('http://x/a'), context)
    const second = handler(new Request('http://x/b'), context)
    loaded.resolve((request) => new Response(new URL(request.url).pathname))
    expect(await Promise.all([(await first).text(), (await second).text()])).toEqual(['/a', '/b'])
    await handler(new Request('http://x/c'), context)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('retries a load that failed', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('module threw'))
      .mockResolvedValueOnce(() => new Response('ok'))
    const handler = lazyFetch(load)
    const failure = await Promise.resolve(handler(new Request('http://x/'), context)).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(LazyRouteLoadError)
    expect((failure as Error).cause).toEqual(new Error('module threw'))
    expect(await (await handler(new Request('http://x/'), context)).text()).toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('passes the request and context through unchanged', async () => {
    const seen: [Request, PluginRequestContext][] = []
    const handler = lazyFetch(async () => (request, received) => {
      seen.push([request, received])
      return new Response(null, { status: 204 })
    })
    const request = new Request('http://x/')
    await handler(request, context)
    expect(seen).toEqual([[request, context]])
    expect(seen[0][0]).toBe(request)
    expect(seen[0][1]).toBe(context)
  })

  it('answers the error envelope through the plugin host when the load fails', async () => {
    registerRoute({ plugin: 'lazy', prefix: '/data', fetch: lazyFetch(() => Promise.reject(new Error('module threw'))) })
    const res = await call('/v1/p/lazy/data')
    expect(res.status).toBe(500)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'internal' })
  })
})

describe('lazyRouter', () => {
  const install = (load: () => Promise<Hono<AppEnv>>, prefix = '/repos') => {
    registerRoute({ plugin: 'lazy', prefix, router: lazyRouter(load) })
  }

  it('serves the loaded router with the host request: principal, path, parameters and body', async () => {
    install(async () => new Hono<AppEnv>()
      .get('/', (c) => c.json({ owner: ownerId(c), at: 'root' }))
      .post('/:owner/:repo', async (c) => c.json({ owner: ownerId(c), params: c.req.param(), body: await c.req.json() })))
    expect(await (await call('/v1/p/lazy/repos')).json()).toEqual({ owner: 'james', at: 'root' })
    const res = await call('/v1/p/lazy/repos/acme/web', { method: 'POST', body: JSON.stringify({ title: 'Fix' }) })
    expect(await res.json()).toEqual({ owner: 'james', params: { owner: 'acme', repo: 'web' }, body: { title: 'Fix' } })
  })

  it('keeps the first registered route ahead of a later overlapping one', async () => {
    install(async () => new Hono<AppEnv>()
      .route('/', new Hono<AppEnv>().get('/:owner/:repo/pulls/:number', (c) => c.text('detail')))
      .route('/', new Hono<AppEnv>().get('/:owner/:repo/pulls/:number', (c) => c.text('later'))))
    expect(await (await call('/v1/p/lazy/repos/acme/web/pulls/1')).text()).toBe('detail')
  })

  it('lets a path the loaded router does not serve fall through to the plugin fetch dispatcher', async () => {
    install(async () => new Hono<AppEnv>().get('/known', (c) => c.text('router')))
    registerRoute({ plugin: 'lazy', prefix: '', fetch: async () => new Response('fetch') })
    expect(await (await call('/v1/p/lazy/repos/unknown')).text()).toBe('fetch')
    expect(await (await call('/v1/p/lazy/repos/known')).text()).toBe('router')
  })

  it('still requires a signed-in caller before loading anything', async () => {
    const load = vi.fn(async () => new Hono<AppEnv>().get('/', (c) => c.text('open')))
    install(load)
    const res = await createApp().fetch(new Request('http://127.0.0.1:4317/v1/p/lazy/repos'), ENV)
    expect(res.status).toBe(401)
    expect(load).not.toHaveBeenCalled()
  })

  it('answers a handler error and a load failure with the error envelope, then retries the load', async () => {
    const load = vi.fn()
      .mockRejectedValueOnce(new Error('module threw'))
      .mockResolvedValue(new Hono<AppEnv>().get('/boom', () => { throw new Error('handler threw') }).get('/', (c) => c.text('ok')))
    install(load)
    const failed = await call('/v1/p/lazy/repos')
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as ApiError).error).toMatchObject({ code: 'internal' })
    expect(await (await call('/v1/p/lazy/repos')).text()).toBe('ok')
    const thrown = await call('/v1/p/lazy/repos/boom')
    expect(thrown.status).toBe(500)
    expect(((await thrown.json()) as ApiError).error).toMatchObject({ code: 'internal' })
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('builds the router once for concurrent first requests', async () => {
    const loaded = deferred<Hono<AppEnv>>()
    const load = vi.fn(() => loaded.promise)
    install(load)
    const app = createApp()
    const request = () => app.fetch(new Request('http://127.0.0.1:4317/v1/p/lazy/repos', { headers: { authorization: 'Bearer d' } }), ENV)
    const pending = [request(), request()]
    loaded.resolve(new Hono<AppEnv>().get('/', (c) => c.text('ok')))
    expect(await Promise.all((await Promise.all(pending)).map((res) => res.text()))).toEqual(['ok', 'ok'])
    expect(load).toHaveBeenCalledTimes(1)
  })
})
