import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type AppEnv, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentSessionList } from '../../contract/wire'
import * as schema from '../../node/schema'
import { eq } from 'drizzle-orm'
import { FakeAgentDriver } from '../drivers/fake'
import { ManagedAgentRuntime } from '../sessions/runtime'
import { managedAgents, setManagedAgentsBridge } from './managed'
import { managedAgentsBridge } from './managedBridge'

const taskId = '00000000-0000-4000-8000-000000000001'
const workspaceId = '00000000-0000-4000-8000-000000000002'

describe('session roster pagination through the managed route', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let app: Hono<AppEnv>
  let ids: string[]
  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    vi.spyOn(ctx.core.tasks, 'active').mockResolvedValue([{ id: taskId }] as never)
    vi.spyOn(ctx.core.tasks, 'idsForWorkspace').mockResolvedValue([taskId])
    runtime = new ManagedAgentRuntime({ db: ctx.storage.open(), dataDir: ctx.dataDir, core: ctx.core,
      internalEnv: () => ({}), secrets: ctx.env.SECRETS, currentUserId: () => null })
    setManagedAgentsBridge(managedAgentsBridge(runtime))
    app = new Hono<AppEnv>()
    app.use('*', async (c, next) => { c.set('principal', { kind: 'device', userId: 'owner' } as never); await next() })
    app.route('/api', managedAgents)
    const provider = await new FakeAgentDriver().probe()
    ids = []
    for (let n = 0; n < 205; n++) {
      const session = await runtime.store.createSession({ taskId, providerId: 'fake', profileId: 'fake',
        kind: 'interactive', title: 'Synthetic', config: {} }, provider)
      await ctx.storage.open().update(schema.agentSessions).set({ updatedAt: n < 103 ? 1000 : 2000 })
        .where(eq(schema.agentSessions.id, session.id))
      ids.push(session.id)
    }
  })
  afterEach(async () => { setManagedAgentsBridge(null); await runtime.stop(); ctx.cleanup(); vi.restoreAllMocks() })

  async function read(query: URLSearchParams) {
    const result = await app.request(`/api/sessions?${query}`)
    expect(result.status).toBe(200)
    return await result.json() as AgentSessionList
  }
  const query = (limit: number) => new URLSearchParams({ taskId, limit: String(limit), cursorFormat: 'tuple-v1' })

  it.each([1, 5, 100])('reaches all tied and mixed timestamps exactly once with limit %i', async (limit) => {
    const params = query(limit), seen: string[] = []
    do {
      const page = await read(params)
      seen.push(...page.sessions.map((session) => session.id))
      if (!page.nextCursor) break
      params.set('cursor', page.nextCursor)
    } while (seen.length <= ids.length)
    expect(seen).toEqual([...ids.slice(103).sort().reverse(), ...ids.slice(0, 103).sort().reverse()])
    expect(new Set(seen).size).toBe(205)
  })

  it('seeks from encoded values after the anchor is deleted and preserves scoped filters', async () => {
    const db = ctx.storage.open()
    await db.update(schema.agentSessions).set({ archivedAt: 99, attention: 'error' })
    const params = query(5)
    params.set('workspaceId', workspaceId); params.set('archived', 'true')
    params.set('attention', 'true'); params.set('search', 'Synthetic')
    const first = await read(params)
    const anchor = first.sessions.at(-1)!
    await db.delete(schema.agentSessions).where(eq(schema.agentSessions.id, anchor.id))
    params.set('cursor', first.nextCursor!)
    const second = await read(params)
    const expected = ids.slice(103).sort().reverse()
    expect(second.sessions.map((session) => session.id)).toEqual(expected.slice(5, 10))
    expect(ctx.core.tasks.idsForWorkspace).toHaveBeenCalledWith(workspaceId)
  })

  it('retains numeric cursor compatibility and rejects malformed or unnegotiated tuples', async () => {
    const legacy = new URLSearchParams({ taskId, limit: '5' })
    const first = await read(legacy)
    expect(first.nextCursor).toBe('2000')
    legacy.set('cursor', first.nextCursor!)
    expect((await read(legacy)).sessions.every((session) => session.updatedAt === 1000)).toBe(true)
    const opted = query(5); opted.set('cursor', '2000')
    expect((await read(opted)).nextCursor).toMatch(/^v1:1000:/)
    for (const cursor of [`v1:2000:${ids[0]}`, 'v1:NaN:x', 'v1:9007199254740992:' + ids[0], 'x'.repeat(200)]) {
      const params = new URLSearchParams({ taskId, cursor })
      expect((await app.request(`/api/sessions?${params}`)).status).toBe(400)
      if (cursor === `v1:2000:${ids[0]}`) continue
      params.set('cursorFormat', 'tuple-v1')
      expect((await app.request(`/api/sessions?${params}`)).status).toBe(400)
    }
  })
})
