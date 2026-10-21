import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

// public/sw.js runs outside the bundle, so this runs its source against a fake worker scope.
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

type Handler = (event: {
  request: { method: string; url: string; mode: string }
  respondWith: (answer: Promise<Response>) => void
  waitUntil: (work: Promise<unknown>) => void
}) => void

function worker(fetchImpl: (request: unknown) => Promise<Response>) {
  const stored = new Map<unknown, Response>()
  let handler: Handler | undefined
  new Function('self', 'location', 'caches', 'fetch', 'Response', source)(
    { addEventListener: (_type: string, listener: Handler) => (handler = listener) },
    new URL('https://studio.tail.ts.net'),
    {
      open: async () => ({ put: async (key: unknown, response: Response) => void stored.set(key, response) }),
      match: async (key: unknown) => stored.get(key),
    },
    fetchImpl,
    Response,
  )
  const visit = async (url: string, mode = 'no-cors', method = 'GET') => {
    const respondWith = vi.fn()
    const pending: Promise<unknown>[] = []
    handler!({ request: { method, url, mode }, respondWith, waitUntil: (work) => pending.push(work) })
    await Promise.all(pending)
    return respondWith.mock.calls[0]?.[0] as Response | undefined
  }
  return { visit, stored }
}

describe('the service worker', () => {
  it('leaves the Node’s data to the network and the client’s own cache', async () => {
    const { visit, stored } = worker(async () => new Response('x'))
    for (const path of ['/node/v1/core/tasks', '/session', '/events'])
      expect(await visit(`https://studio.tail.ts.net${path}`)).toBeUndefined()
    expect(await visit('https://studio.tail.ts.net/node/v1/core/tasks', 'cors', 'POST')).toBeUndefined()
    expect(await visit('https://elsewhere.test/app.js')).toBeUndefined()
    expect(stored.size).toBe(0)
  })

  it('keeps the app’s files, and serves them when the gateway is down', async () => {
    let up = true
    const { visit, stored } = worker(async () => {
      if (!up) throw new TypeError('Failed to fetch')
      return new Response('page')
    })
    await visit('https://studio.tail.ts.net/t/task-1', 'navigate')
    expect([...stored.keys()]).toEqual(['/'])
    up = false
    const answer = await visit('https://studio.tail.ts.net/t/task-2', 'navigate')
    expect(await answer!.text()).toBe('page')
  })
})
