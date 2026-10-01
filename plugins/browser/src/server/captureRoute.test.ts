import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginFetchHandler, Principal } from '@acorn/plugin-api/node'
import { makeTestNodeContext, makeTestRequestContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import { browserPlugin } from '../node/index'
import { captureStore } from './captures'

let ctx: TestNodeContext
let plugin: ReturnType<typeof browserPlugin>
let handler: PluginFetchHandler
let id: string
beforeEach(async () => {
  ctx = makeTestNodeContext({ plugin: { name: 'browser' } })
  vi.spyOn(ctx.routes, 'fetch').mockImplementation((fetch) => { handler = fetch })
  plugin = browserPlugin()
  await plugin.init(ctx)
  id = (await captureStore(ctx.storage.open()).put({ taskId: 'own-task', mime: 'image/png', bytes: Buffer.from('synthetic-pixels') })).id
})
afterEach(async () => { await plugin.dispose?.(); ctx.cleanup(); vi.restoreAllMocks() })

async function read(principal: Principal, captureId = id) {
  const context = await makeTestRequestContext({ plugin: 'browser', principal, env: ctx.env })
  return handler(new Request(`http://node/${captureId}`), context)
}

describe('capture byte authorization', () => {
  it.each<Principal>([
    { kind: 'device', userId: 'owner' },
    { kind: 'internal', userId: 'owner', scope: 'service' },
    { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'own-task' },
  ])('serves an authorized $kind/$scope caller with immutable image headers', async (principal) => {
    const response = await read(principal)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('synthetic-pixels')
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toContain('private')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  })

  it('answers foreign and unknown capture IDs identically without image headers or bytes', async () => {
    const caller: Principal = { kind: 'internal', userId: 'owner', scope: 'task', taskId: 'foreign-task' }
    const foreign = await read(caller)
    const absent = await read(caller, 'missing-capture')
    expect(foreign.status).toBe(404)
    expect(absent.status).toBe(404)
    expect([...foreign.headers]).toEqual([...absent.headers])
    expect(await foreign.text()).toBe('')
    expect(await absent.text()).toBe('')
  })

  it('fails closed for a task credential without its task ID', async () => {
    expect((await read({ kind: 'internal', userId: 'owner', scope: 'task' })).status).toBe(404)
  })
})
