import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Hono } from 'hono'
import { afterEach, describe, expect, it } from 'vitest'
import type { Env } from '../bindings'
import type { AppEnv, Principal } from '../middleware/auth'
import type { PreviewControl, PreviewRequest } from '../transport/preview/previewControl'
import { serveLoopback } from './loopbackRoute'

// The route a plugin gets from `ctx.routes.loopback`: who may use it, and what it shows.

const MOUNT = '/v1/p/preview/tasks/:taskId/proxy'
const device: Principal = { kind: 'device', userId: 'owner', deviceId: 'phone-1', deviceKind: 'phone' }
const taskToken: Principal = { kind: 'internal', userId: 'owner', scope: 'task', taskId: 't1' }
const service: Principal = { kind: 'internal', userId: 'owner', scope: 'service' }

let dev: Server | undefined
afterEach(() => void dev?.close())

async function devServer(): Promise<number> {
  dev = createServer((req, res) => res.end(`dev server saw ${req.url}`))
  await new Promise<void>((resolve) => dev!.listen(0, '127.0.0.1', resolve))
  return (dev.address() as AddressInfo).port
}

function app(options: { port: number | null; previews?: PreviewControl; ownPort?: number }) {
  const router = new Hono<AppEnv>()
  router.use('*', async (c, next) => {
    c.set('principal', ({ device, taskToken, service, none: null } as const)[c.req.header('x-who') as 'device'] ?? null)
    await next()
  })
  const target = async (params: Record<string, string>) => (params.taskId === 'missing' ? null : options.port)
  // The shape the plugin host mounts: a bare handler that serves every request under the prefix.
  router.route(
    MOUNT,
    new Hono<AppEnv>().all('/*', (c) => serveLoopback(c, MOUNT, target)),
  )
  const env = {
    ...(options.previews ? { PREVIEWS: options.previews } : {}),
    incoming: { socket: { localPort: options.ownPort ?? 1 } },
  } as unknown as Env
  return (path: string, who: string | undefined, init: RequestInit = {}) =>
    router.fetch(
      new Request(`https://node.test${MOUNT.replace(':taskId', 't1')}${path}`, {
        ...init,
        headers: { ...(who ? { 'x-who': who } : {}), ...(init.headers as Record<string, string>) },
      }),
      env,
    )
}

describe('a loopback route', () => {
  it('refuses a task token, and the Node’s own service, with 403', async () => {
    const call = app({ port: await devServer() })
    for (const who of ['taskToken', 'service']) {
      expect((await call('/', who)).status).toBe(403)
      expect((await call('/__acorn/open', who, { method: 'POST' })).status).toBe(403)
    }
    expect((await call('/', undefined)).status).toBe(401)
  })

  it('shows a paired device the dev server, below the mount', async () => {
    const call = app({ port: await devServer() })
    const answer = await call('/src/main.ts?t=1', 'device')
    expect(await answer.text()).toBe('dev server saw /src/main.ts?t=1')
    expect(await (await call('', 'device')).text()).toBe('dev server saw /')
  })

  it('answers 404 when the plugin has no port, and refuses the Node’s own port', async () => {
    expect((await app({ port: null })('/', 'device')).status).toBe(404)
    const port = await devServer()
    expect((await app({ port, ownPort: port })('/', 'device')).status).toBe(403)
  })

  it('opens a preview for the device that asked, framed by the page it names', async () => {
    const opened: PreviewRequest[] = []
    const previews: PreviewControl = {
      open: (request) => (opened.push(request), { url: 'https://abc.def.preview.test/__acorn/preview?key=k' }),
    }
    const call = app({ port: await devServer(), previews })
    const answer = await call('/__acorn/open', 'device', {
      method: 'POST',
      body: JSON.stringify({ ancestor: 'https://app.example' }),
    })
    expect(answer.status).toBe(200)
    expect(await answer.json()).toEqual({ url: 'https://abc.def.preview.test/__acorn/preview?key=k' })
    expect(opened[0]).toMatchObject({ deviceId: 'phone-1', ancestor: 'https://app.example' })
    expect(await opened[0]!.port()).not.toBeNull()
  })

  it('refuses a frame ancestor that is not an origin', async () => {
    const previews: PreviewControl = { open: () => ({ url: 'x' }) }
    const call = app({ port: await devServer(), previews })
    for (const ancestor of ["'self'", 'https://a.example; script-src *', 'https://a.example/path', '*']) {
      const answer = await call('/__acorn/open', 'device', { method: 'POST', body: JSON.stringify({ ancestor }) })
      expect(answer.status).toBe(400)
    }
  })

  it('says why a preview is not available, and has no address for a task with no app', async () => {
    const off = app({ port: await devServer() })
    const answer = await off('/__acorn/open', 'device', { method: 'POST' })
    expect(answer.status).toBe(503)
    expect(await answer.json()).toMatchObject({ error: { code: 'preview_unavailable', details: { reason: 'off' } } })

    const previews: PreviewControl = { open: () => ({ unavailable: 'starting' }) }
    const starting = app({ port: await devServer(), previews })
    expect(await (await starting('/__acorn/open', 'device', { method: 'POST' })).json()).toMatchObject({
      error: { details: { reason: 'starting' } },
    })
    const none = app({ port: null, previews })
    expect((await none('/__acorn/open', 'device', { method: 'POST' })).status).toBe(404)
  })
})
