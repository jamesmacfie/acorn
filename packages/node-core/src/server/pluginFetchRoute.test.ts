import { afterEach, describe, expect, it } from 'vitest'
import type { ApiError } from '@acorn/protocol/api.ts'
import type { Env } from '../main/bindings'
import { createApp } from './index'
import type { PluginRequestContext } from './plugin/types'
import { registerRoute, removePluginRoutes } from './routeRegistry'

// The fetch-shaped route seam a LOADED plugin gets instead of a Hono router
// (docs/security.md § Design rules: a Hono instance cannot cross a process
// boundary, a (Request) → Response function can). What matters here is that the seam behaves like
// the router seam it replaces: same mount, same auth envelope, same relative paths.

// Enough of an Env for authMiddleware to resolve a device principal. Nothing here touches a database.
const ENV = {
  DEVICES: { authenticate: async () => ({ deviceId: 'd1' }) },
  ACTIVE_IDENTITY: { get: () => 'james' },
} as unknown as Env

type Seen = { url: string; context: PluginRequestContext }

const install = (prefix: string) => {
  const seen: Seen[] = []
  registerRoute({
    plugin: 'ntfy',
    prefix,
    fetch: async (request, context) => {
      seen.push({ url: request.url, context })
      return Response.json({ body: await request.text() })
    },
  })
  return seen
}

const call = (path: string, init?: RequestInit) =>
  createApp().fetch(
    new Request(`http://127.0.0.1:4317${path}`, { headers: { authorization: 'Bearer d' }, ...init }),
    ENV,
  )

afterEach(() => removePluginRoutes('ntfy'))

describe('a fetch-shaped plugin route', () => {
  it('answers at the plugin namespace root and below it', async () => {
    const seen = install('')
    expect((await call('/v2/p/ntfy')).status).toBe(200)
    expect((await call('/v2/p/ntfy/topics/acorn')).status).toBe(200)
    // The mount is stripped, so the handler sees the same relative paths a mounted router would.
    expect(seen.map((entry) => new URL(entry.url).pathname)).toEqual(['/', '/topics/acorn'])
  })

  it('keeps the query string and honours a declared prefix', async () => {
    const seen = install('/send')
    expect((await call('/v2/p/ntfy/send/now?priority=high')).status).toBe(200)
    const url = new URL(seen[0].url)
    expect(url.pathname).toBe('/now')
    expect(url.searchParams.get('priority')).toBe('high')
  })

  it('forwards a request body', async () => {
    const seen = install('')
    const res = await call('/v2/p/ntfy', { method: 'POST', body: 'hello' })
    expect(await res.json()).toEqual({ body: 'hello' })
    expect(seen).toHaveLength(1)
  })

  it('hands the handler the authenticated principal', async () => {
    const seen = install('')
    await call('/v2/p/ntfy')
    expect(seen[0].context.principal).toEqual({ kind: 'device', userId: 'james', deviceId: 'd1' })
    expect(seen[0].context.userId).toBe('james')
    expect(seen[0].context.providers.resource).toBeTypeOf('function')
  })

  it('sits behind the same requireUser gate as every other /v2 route', async () => {
    const seen = install('')
    const res = await createApp().fetch(new Request('http://127.0.0.1:4317/v2/p/ntfy'), ENV)
    expect(res.status).toBe(401)
    expect(((await res.json()) as ApiError).error).toMatchObject({ code: 'unauthenticated' })
    // Not merely rejected downstream — the handler is never reached at all.
    expect(seen).toEqual([])
  })
})
