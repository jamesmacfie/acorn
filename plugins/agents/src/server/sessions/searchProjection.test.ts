import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, makeTestPluginDb, type TestNodeContext, type TestPluginDb } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire'
import { AgentStore } from './store'
import { ManagedAgentRuntime } from './runtime'
import * as schema from '../../node/schema'

const provider: AgentProviderDescriptor = {
  id: 'fake', profileId: 'fake', label: 'Fake', driverKind: 'acp', driverVersion: '1', installed: true,
  authenticated: true, statusAuthority: 'protocol', capabilities: [], configOptions: [], commands: [], skills: [], diagnostics: [],
}
const chunk = (text: string, messageId = 'm') => ({ type: 'assistant_message' as const, append: true, messageId, text })

describe('durable message search projection', () => {
  let ctx: TestNodeContext
  let fixture: TestPluginDb
  let store: AgentStore
  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    fixture = makeTestPluginDb('agents')
    store = new AgentStore(fixture.db, ctx.core)
  })
  afterEach(() => { fixture.cleanup(); ctx.cleanup() })
  const session = (taskId = 'task') => store.createSession({ taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
  const dirty = () => fixture.db.all(sql`SELECT * FROM agent_search_dirty`)

  it('leaves canonical deltas complete and clients stripped until a raw read materializes the head', async () => {
    const s = await session()
    await store.recordEvent(s.id, null, chunk('flux ca'))
    await store.recordEvent(s.id, null, chunk('pacitor charged'))
    expect(fixture.db.get<{ text: string }>(sql`SELECT search_text AS text FROM agent_events WHERE seq = 1`)!.text).toBe('flux ca')
    expect((await store.clientEventPage(s.id)).events.map((record) => record.event)).toEqual([chunk('flux ca'), chunk('pacitor charged')])
    expect((await store.clientSnapshot(s.id)).events.every((record) => !('searchText' in record))).toBe(true)
    expect(dirty()).toHaveLength(1)
    const page = await store.eventPage(s.id, 0, 1)
    expect(page.events[0]!.searchText).toBe('flux capacitor charged')
    expect(page.nextCursor).toBe(1)
    expect((await store.exportSnapshot(s.id)).events.map((record) => record.searchText)).toEqual(['flux capacitor charged', null])
    expect(dirty()).toEqual([])
  })

  it('catches up the corpus outside the task filter and makes snippets match the current generation', async () => {
    const a = await session('a'), b = await session('b')
    await store.recordEvent(a.id, 'one', chunk('flux ca'))
    await store.recordEvent(b.id, 'two', chunk('another ca'))
    await store.recordEvent(a.id, 'one', chunk('pacitor charged'))
    await store.recordEvent(b.id, 'two', chunk('pacitor humming'))
    const hits = await store.searchTaskSessions('capacitor charged', ['a'], 10)
    expect(hits).toMatchObject([{ taskId: 'a', preview: 'flux capacitor charged' }])
    expect(dirty()).toEqual([])
    expect(fixture.db.all<{ content: string }>(sql`SELECT content FROM agent_events_fts ORDER BY rowid`).map((row) => row.content))
      .toEqual(['flux capacitor charged', 'another capacitor humming'])
    expect(fixture.db.all(sql`SELECT event_id FROM agent_events_fts WHERE agent_events_fts MATCH '"flux capacitor"'`)).toHaveLength(1)
    expect(fixture.db.all(sql`SELECT event_id FROM agent_events_fts WHERE agent_events_fts MATCH 'capacit*'`)).toHaveLength(2)
  })

  it('separates reused message ids across tools, turns, reasoning, and sequence gaps', async () => {
    const s = await session()
    await store.recordEvent(s.id, 'one', chunk('firstword'))
    await store.recordEvent(s.id, 'one', { type: 'tool', tool: { id: 't', title: 'run', status: 'completed' } })
    await store.recordEvent(s.id, 'one', chunk('secondword'))
    await store.recordEvent(s.id, 'two', chunk('thirdword'))
    await store.recordEvent(s.id, 'two', { type: 'reasoning', append: true, messageId: 'm', text: 'fourthword' })
    await store.recordEvent(s.id, 'two', chunk('fifthword'))
    const gap = await store.recordEvent(s.id, 'two', chunk('sixthword'))
    await store.recordEvent(s.id, 'two', chunk('seventhword'))
    fixture.db.delete(schema.agentEvents).where(sql`id = ${gap.id}`).run()
    expect(await store.searchSessions('firstword secondword')).toEqual([])
    expect(await store.searchSessions('secondword thirdword')).toEqual([])
    expect(await store.searchSessions('thirdword fourthword')).toEqual([])
    expect(await store.searchSessions('fifthword seventhword')).toEqual([])
    expect((await store.exportSnapshot(s.id)).events.filter((record) => record.searchText !== null).map((record) => record.searchText))
      .toEqual(['firstword', 'run', 'secondword', 'thirdword', 'fourthword', 'fifthword', 'seventhword'])
  })

  it('recovers lost dirty progress and corrupt or missing indexes from canonical content after reopening', async () => {
    const s = await session()
    await store.recordEvent(s.id, null, chunk('flux ca'))
    await store.recordEvent(s.id, null, chunk('pacitor'))
    fixture.db.run(sql`DELETE FROM agent_search_dirty`)
    fixture.db.close()
    const reopened = fixture.openConnection()
    try {
      store = new AgentStore(reopened, ctx.core)
      expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual([s.id])
      reopened.run(sql`DELETE FROM agent_events_fts`)
      reopened.run(sql`UPDATE agent_events SET search_text = 'wrong' WHERE seq = 1`)
      reopened.run(sql`DROP TABLE agent_events_fts`)
      reopened.run(sql`DROP TRIGGER agent_search_insert`)
      store = new AgentStore(reopened, ctx.core)
      expect((await store.searchTaskSessions('capacitor', ['task'], 10))[0]!.preview).toBe('flux capacitor')
      expect((await store.snapshot(s.id)).events[0]!.searchText).toBe('flux capacitor')
      await store.recordEvent(s.id, null, chunk(' energized'))
      expect((await store.searchSessions('energized')).map((row) => row.id)).toEqual([s.id])
    } finally { reopened.close() }
  })

  it('repairs incorrect index content and rowid drift without changing event identity', async () => {
    const s = await session()
    const event = await store.recordEvent(s.id, null, chunk('canonical capacitor'))
    await store.flushSearch()
    fixture.db.run(sql`UPDATE agent_events_fts SET content = 'incorrect content' WHERE event_id = ${event.id}`)
    store = new AgentStore(fixture.db, ctx.core)
    expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual([s.id])
    fixture.db.run(sql`UPDATE agent_events SET rowid = rowid + 100`)
    fixture.db.run(sql`VACUUM`)
    store = new AgentStore(fixture.db, ctx.core)
    expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual([s.id])
    expect(fixture.db.all(sql`SELECT 1 FROM agent_events_fts f LEFT JOIN agent_events e ON e.rowid = f.rowid AND e.id = f.event_id WHERE e.id IS NULL`)).toEqual([])
    expect((await store.exportSnapshot(s.id)).events[0]!.id).toBe(event.id)
  })

  it('projects canonical SQL mutations even when the replacement text stays equal', async () => {
    const s = await session()
    const event = await store.recordEvent(s.id, null, { type: 'assistant_message', text: 'identical words' })
    await store.flushSearch()
    fixture.db.update(schema.agentEvents).set({ eventJson: JSON.stringify({
      type: 'tool', tool: { id: 't', title: 'identical words', status: 'completed' },
    }) }).where(sql`id = ${event.id}`).run()
    expect((await store.searchSessions('identical')).map((row) => row.id)).toEqual([s.id])
    expect(fixture.db.get(sql`SELECT content, tool FROM agent_events_fts WHERE event_id = ${event.id}`))
      .toEqual({ content: null, tool: 'identical words' })
  })

  it('rolls back a failed catch-up and retries it without losing dirty work', async () => {
    const s = await session()
    await store.recordEvent(s.id, null, chunk('flux ca'))
    await store.recordEvent(s.id, null, chunk('pacitor'))
    fixture.db.run(sql.raw(`CREATE TRIGGER fail_projection BEFORE UPDATE OF search_text ON agent_events
      BEGIN SELECT RAISE(ABORT, 'synthetic projection failure'); END`))
    await expect(store.searchSessions('capacitor')).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'synthetic projection failure' }) })
    expect(dirty()).toHaveLength(1)
    fixture.db.run(sql`DROP TRIGGER fail_projection`)
    expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual([s.id])
    expect(dirty()).toEqual([])
  })

  it('retries projector initialization after an index rebuild fails', async () => {
    const s = await session()
    await store.recordEvent(s.id, null, chunk('flux ca'))
    await store.recordEvent(s.id, null, chunk('pacitor'))
    fixture.db.run(sql`DROP TABLE agent_events_fts`)
    fixture.db.run(sql.raw(`CREATE TRIGGER fail_projection BEFORE UPDATE OF search_text ON agent_events
      BEGIN SELECT RAISE(ABORT, 'synthetic projection failure'); END`))
    store = new AgentStore(fixture.db, ctx.core)
    await expect(store.searchSessions('capacitor')).rejects.toMatchObject({ cause: expect.objectContaining({ message: 'synthetic projection failure' }) })
    fixture.db.run(sql`DROP TRIGGER fail_projection`)
    expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual([s.id])
    expect(dirty()).toEqual([])
  })

  it('keeps ranks and snippets in the same SQLite snapshot while another connection commits a head', async () => {
    const s = await session()
    await store.recordEvent(s.id, null, chunk('flux capacitor charged'))
    const other = fixture.openConnection()
    await store.flushSearch()
    const prepare = fixture.db.$client.prepare.bind(fixture.db.$client)
    let mutated = false
    fixture.db.$client.prepare = (query: string) => {
      if (query.includes('snippet(') && !mutated) {
        mutated = true
        other.update(schema.agentEvents).set({ eventJson: JSON.stringify(chunk('flux capacitor charged updated')),
          searchText: 'flux capacitor charged updated' }).where(sql`session_id = ${s.id}`).run()
      }
      return prepare(query)
    }
    try {
      expect((await store.searchTaskSessions('capacitor', ['task'], 10))[0]!.preview).toBe('flux capacitor charged')
      expect(mutated).toBe(true)
      expect((await store.searchTaskSessions('capacitor', ['task'], 10))[0]!.preview).toBe('flux capacitor charged updated')
    } finally { fixture.db.$client.prepare = prepare; other.close() }
  })

  it('materializes an open stream before runtime shutdown returns', async () => {
    const runtime = new ManagedAgentRuntime({ db: fixture.db, dataDir: fixture.dataDir, core: ctx.core,
      internalEnv: () => ({}), secrets: ctx.env.SECRETS, currentUserId: () => null })
    const s = await runtime.store.createSession({ taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive', config: {} }, provider)
    try {
      await runtime.store.recordEvent(s.id, null, chunk('flux ca'))
      await runtime.store.recordEvent(s.id, null, chunk('pacitor'))
    } finally { await runtime.stop() }
    expect(fixture.db.get<{ text: string }>(sql`SELECT search_text AS text FROM agent_events WHERE seq = 1`)!.text).toBe('flux capacitor')
    expect(dirty()).toEqual([])
  })

  it('flushes at stream boundaries and never resurrects deleted sessions or message heads', async () => {
    const s = await session()
    const first = await store.recordEvent(s.id, null, chunk('flux ca'))
    await store.recordEvent(s.id, null, chunk('pacitor charged'))
    await store.recordEvent(s.id, null, { type: 'turn_completed' })
    expect(dirty()).toEqual([])
    await store.recordEvent(s.id, null, chunk(' live', 'other'))
    fixture.db.delete(schema.agentEvents).where(sql`id = ${first.id}`).run()
    expect(await store.searchSessions('flux')).toEqual([])
    expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual([])
    expect((await store.searchSessions('pacitor')).map((row) => row.id)).toEqual([s.id])
    await store.deleteSession(s.id)
    await store.flushSearch()
    expect(dirty()).toEqual([])
    expect(fixture.db.all(sql`SELECT * FROM agent_events_fts`)).toEqual([])
  })

  it('keeps rank ties ordered by session update time, and preserves title and artifact matches', async () => {
    const a = await session(), b = await session()
    await store.recordEvent(a.id, null, chunk('identical words'))
    await store.recordEvent(b.id, null, chunk('identical words'))
    fixture.db.run(sql`UPDATE agent_sessions SET updated_at = CASE id WHEN ${a.id} THEN 1 ELSE 2 END`)
    expect((await store.searchSessions('identical')).map((row) => row.id)).toEqual([b.id, a.id])
    await store.patchSession(a.id, { title: 'unique title' })
    expect((await store.searchSessions('unique title')).map((row) => row.id)).toEqual([a.id])
    fixture.db.insert(schema.agentArtifacts).values({ id: 'artifact', sessionId: b.id, kind: 'file', title: 'unique artifact', storageKey: 'key', createdAt: 1 }).run()
    expect((await store.searchSessions('unique artifact')).map((row) => row.id)).toEqual([b.id])
  })
})

it('upgrades a populated pre-0012 database without changing the ledger or its whole-message search', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'acorn-search-migrations-'))
  const migrations = new URL('../../../migrations/', import.meta.url)
  const journal = JSON.parse(readFileSync(new URL('meta/_journal.json', migrations), 'utf8'))
  journal.entries = journal.entries.filter((entry: { idx: number }) => entry.idx < 12)
  const { mkdirSync } = await import('node:fs')
  mkdirSync(join(folder, 'meta'))
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify(journal))
  for (const entry of journal.entries) writeFileSync(join(folder, `${entry.tag}.sql`), readFileSync(new URL(`${entry.tag}.sql`, migrations)))
  const legacy = makeTestPluginDb('agents', folder)
  let ctx: TestNodeContext | undefined
  try {
    legacy.db.insert(schema.agentSessions).values({ id: 's', taskId: 'task', providerId: 'fake', profileId: 'fake', kind: 'interactive',
      driverKind: 'acp', driverVersion: '1', runtimeState: 'ready', statusAuthority: 'protocol', title: 'migration', createdAt: 1, updatedAt: 1, lastEventSeq: 2 }).run()
    legacy.db.insert(schema.agentEvents).values([
      { id: 'first', sessionId: 's', seq: 1, schemaVersion: 1, eventJson: JSON.stringify(chunk('flux ca')), searchText: 'flux capacitor', createdAt: 1 },
      { id: 'rest', sessionId: 's', seq: 2, schemaVersion: 1, eventJson: JSON.stringify(chunk('pacitor')), searchText: null, createdAt: 2 },
    ]).run()
    legacy.db.close()
    ctx = makeTestNodeContext({ plugin: { name: 'agents' }, dataDir: legacy.dataDir })
    const store = new AgentStore(ctx.storage.open(), ctx.core)
    expect((await store.exportSnapshot('s')).events.map((record) => ({ id: record.id, seq: record.seq, event: record.event, searchText: record.searchText })))
      .toEqual([{ id: 'first', seq: 1, event: chunk('flux ca'), searchText: 'flux capacitor' }, { id: 'rest', seq: 2, event: chunk('pacitor'), searchText: null }])
    expect((await store.searchSessions('capacitor')).map((row) => row.id)).toEqual(['s'])
  } finally { ctx?.cleanup(); legacy.cleanup(); rmSync(folder, { recursive: true, force: true }) }
})
