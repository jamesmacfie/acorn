import { existsSync, writeFileSync } from 'node:fs'
import { afterEach, expect, it, vi } from 'vitest'
import { makeTestPluginDb } from '../../packages/plugin-api/src/testkit'
import { createHttpFetch } from '../../plugins/http/src/server/routes/http'
import type { PluginRequestContext } from '@acorn/plugin-api/node'

const cleanups: (() => void)[] = []
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.unstubAllGlobals() })

it('records caller cancellation at the actual portable send route', async () => {
  const plugin = makeTestPluginDb('http'); cleanups.push(plugin.cleanup)
  const core = { tasks: {}, projects: { byId: async () => ({ id: 'project', path: null }) }, secrets: {}, proc: {} }
  const handler = createHttpFetch(plugin.db, core as Parameters<typeof createHttpFetch>[1])
  const context = { userId: 'synthetic', principal: { kind: 'device', userId: 'synthetic' } } as PluginRequestContext
  const input = { method: 'GET', url: 'https://synthetic.invalid/', headers: [], bodyMode: 'none', body: '', auth: { mode: 'none' }, vars: {}, executionTaskId: null }
  const caller = new AbortController()
  let outboundSignal: AbortSignal | null = null
  let finish!: (response: Response) => void
  let requests = 0
  const transport = vi.fn(async (_url, options) => {
    requests++; outboundSignal = options.signal
    return await new Promise<Response>(resolve => { finish = resolve })
  })
  vi.stubGlobal('fetch', transport)
  const request = new Request('http://synthetic/projects/project/send', { method: 'POST', signal: caller.signal,
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) })
  const pending = handler(request, context)
  await vi.waitFor(() => expect(requests).toBe(1))
  caller.abort()
  const abortedAfterCaller = outboundSignal!.aborted
  finish(new Response('synthetic response'))
  const response = await pending
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  const destination = new URL(`13-http-send-${tag}.json`, import.meta.url)
  if (tag.startsWith('before') && existsSync(destination)) throw new Error('Use another before tag.')
  writeFileSync(destination, JSON.stringify({ owner: 'actual portable HTTP route/send, synthetic outbound fetch and plugin SQLite',
    callerAborted: caller.signal.aborted, outboundAborted: abortedAfterCaller, outboundRequests: requests, routeStatusAfterCallerAbort: response.status,
    note: 'No network request or command variable ran. Native cancellation propagation through loaded RPC belongs to area02.' }, null, 2) + '\n')
  expect(abortedAfterCaller).toBe(false)
})
