import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, makeTestPluginDb, type TestNodeContext, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire'
import { AgentStore } from './store'
import { sessionHistoryTools } from './sessionHistoryTools'

const provider: AgentProviderDescriptor = {
  id: 'fake', profileId: 'fake', label: 'Fake', driverKind: 'acp', driverVersion: '1', installed: true,
  authenticated: true, statusAuthority: 'protocol', capabilities: [], configOptions: [], commands: [], skills: [], diagnostics: [],
}

describe('own-session history tools', () => {
  let context: TestNodeContext
  let fixture: TestPluginDb
  let store: AgentStore
  beforeEach(() => {
    context = makeTestNodeContext({ plugin: { name: 'agents' } })
    fixture = makeTestPluginDb('agents')
    store = new AgentStore(fixture.db, context.core)
  })
  afterEach(() => { fixture.cleanup(); context.cleanup() })

  it('contributes both history tools as session-required reads', () => {
    expect(sessionHistoryTools(store).map(({ name, scope, risk, requiresSession }) => ({ name, scope, risk, requiresSession }))).toEqual([
      { name: 'session_history_search', scope: 'task', risk: 'read', requiresSession: true },
      { name: 'session_history_read', scope: 'task', risk: 'read', requiresSession: true },
    ])
  })

  it('filters roles before the limit, scopes to the claimed session, and quotes query terms', async () => {
    const own = await store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
    const other = await store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
    await store.recordEvent(own.id, null, { type: 'tool', tool: { id: 't', title: 'alpha', status: 'completed' } })
    await store.recordEvent(own.id, null, { type: 'user_message', text: 'alpha one' })
    await store.recordEvent(own.id, null, { type: 'assistant_message', text: 'alpha two' })
    await store.recordEvent(other.id, null, { type: 'user_message', text: 'alpha foreign' })
    const search = sessionHistoryTools(store)[0]!
    const claim = { taskId: 'task', sessionId: own.id, userLogin: 'test' }
    expect(search).toMatchObject({ scope: 'task', risk: 'read', requiresSession: true })
    const result = await search.handler({ query: 'alpha', role: 'user', limit: 1 }, claim) as { hits: Array<{ seq: number; role: string; excerpt: string }> }
    expect(result.hits).toHaveLength(1)
    expect(result.hits[0]).toMatchObject({ seq: 2, role: 'user' })
    expect(result.hits[0]!.excerpt).toContain('<pasted_content')
    expect(result.hits[0]!.excerpt).toContain('alpha one')
    expect(result.hits[0]!.excerpt).not.toContain('foreign')
    expect((await search.handler({ query: 'alpha OR foreign' }, claim) as { hits: unknown[] }).hits).toEqual([])
    await expect(search.handler({ query: 'alpha' }, { taskId: 'task', userLogin: 'test' })).rejects.toThrow('signed session claim')
    await expect(search.handler({ query: 'alpha' }, { ...claim, taskId: 'another-task' })).rejects.toThrow('unavailable')
  })

  it('reads complete streamed text in pages and excludes artifact content', async () => {
    const own = await store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
    const first = await store.recordEvent(own.id, 'turn', { type: 'assistant_message', append: true, messageId: 'm', text: 'a'.repeat(3_990) })
    await store.recordEvent(own.id, 'turn', { type: 'assistant_message', append: true, messageId: 'm', text: 'b'.repeat(30) })
    const artifact = await store.recordEvent(own.id, 'turn', { type: 'artifact', artifactId: 'id', kind: 'file', title: 'secret title' })
    const read = sessionHistoryTools(store)[1]!
    const claim = { taskId: 'task', sessionId: own.id, userLogin: 'test' }
    const firstPage = await read.handler({ seq: first.seq }, claim) as { text: string; nextOffset: number; truncated: boolean }
    expect(firstPage.text).toContain('a'.repeat(3_990))
    expect(firstPage.text).toContain('<pasted_content')
    expect(firstPage.nextOffset).toBe(4_000)
    expect(firstPage.truncated).toBe(true)
    const secondPage = await read.handler({ seq: first.seq, offset: firstPage.nextOffset }, claim) as { text: string; nextOffset: null; truncated: boolean }
    expect(secondPage.text).toContain('b'.repeat(20))
    expect(secondPage.nextOffset).toBeNull()
    expect(secondPage.truncated).toBe(false)
    expect(await read.handler({ seq: artifact.seq }, claim)).toEqual({ found: false })
    const search = sessionHistoryTools(store)[0]!
    expect((await search.handler({ query: 'secret' }, claim) as { hits: unknown[] }).hits).toEqual([])
    expect(await read.handler({ seq: first.seq, offset: 5_000 }, claim)).toMatchObject({ nextOffset: null, truncated: false })
  })

  it('caps the raw FTS snippet before pasted-content wrapping', async () => {
    const own = await store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
    await store.recordEvent(own.id, null, { type: 'user_message', text: `needle ${'x'.repeat(1_000)}` })
    const hits = await store.searchSessionHistory(own.id, 'needle')
    expect(hits).toHaveLength(1)
    expect(hits[0]!.excerpt).toHaveLength(600)
    expect(hits[0]!.excerpt).toContain('needle')
  })
})
