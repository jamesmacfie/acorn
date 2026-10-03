// The retention pass (docs/data-layer/backup-and-retention.md § Retention) against a real migrated database: core's tasks
// in one file and this plugin's sessions in the other, the way a node has them.
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { makeTestNodeContext, schema as coreSchema, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '../../contract/wire.ts'
import * as schema from '../../node/schema'
import { defaultAgentSessionDefaults } from '../../shared/sessionDefaults'
import { writeAgentSessionDefaults } from '../sessionDefaultsStore'
import { removeExpiredHistory } from './historyRetention'
import { ManagedAgentRuntime } from './runtime'

const DAY = 86_400_000
const OWNER = 'owner'
const PROVIDER: AgentProviderDescriptor = {
  id: 'fake',
  profileId: 'fake',
  label: 'Fake',
  driverKind: 'acp',
  driverVersion: '1',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

describe('removing the agent history of long-archived tasks', () => {
  let ctx: TestNodeContext
  let runtime: ManagedAgentRuntime
  let db: ReturnType<TestNodeContext['storage']['open']>
  const now = Date.now()

  beforeEach(async () => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    db = ctx.storage.open()
    runtime = new ManagedAgentRuntime({
      db,
      dataDir: ctx.dataDir,
      core: ctx.core,
      internalEnv: () => ({}),
      secrets: ctx.env.SECRETS,
      currentUserId: () => OWNER,
    })
    await ctx.db.insert(coreSchema.workspaces).values({ id: 'workspace', name: 'W', createdAt: now, updatedAt: now })
    await ctx.db.insert(coreSchema.projects).values({
      id: 'project', name: 'app', path: null, workspaceId: 'workspace', sort: 0, hidden: false, vcs: 'git',
      defaultBranch: 'main', remoteUrl: null, githubOwner: null, githubName: null, githubRepoId: null,
      createdAt: now, updatedAt: now,
    })
  })

  afterEach(async () => {
    await runtime.stop()
    ctx.cleanup()
  })

  const task = async (id: string, status: 'active' | 'archived', archivedAt: number | null) => {
    await ctx.db.insert(coreSchema.tasks).values({
      id, title: id, origin: 'local', projectId: 'project', branch: id, worktreePath: null,
      status, createdAt: now, updatedAt: now, archivedAt,
    })
    return id
  }

  // A session with a searchable conversation, a turn holding an attachment, a request, and an artifact.
  const session = async (taskId: string, word: string) => {
    const { id } = await runtime.store.createSession({
      taskId, providerId: 'fake', profileId: 'fake', kind: 'interactive', title: `${word} session`, config: {},
    }, PROVIDER)
    const turnId = randomUUID()
    db.insert(schema.agentTurns).values({
      id: turnId, sessionId: id, ordinal: 1, source: 'interactive', status: 'completed', inputJson: '[]',
      idempotencyKey: randomUUID(), createdAt: now,
    }).run()
    await runtime.store.recordEvent(id, turnId, { type: 'user_message', text: `Please fix the ${word} bug.` })
    for (let index = 0; index < 4; index++) {
      await runtime.store.recordEvent(id, turnId, { type: 'tool', tool: { id: `t${index}`, title: `Read ${word}.ts`, status: 'completed' } })
    }
    await runtime.store.recordEvent(id, turnId, { type: 'assistant_message', text: `Fixed the ${word} bug.` })
    db.insert(schema.agentRequests).values({
      id: randomUUID(), sessionId: id, turnId, providerRequestId: randomUUID(), kind: 'question',
      status: 'resolved', title: 'Which one?', createdAt: now,
    }).run()
    const attachment = await runtime.attachments.upload(taskId, `${word}.txt`, 'text/plain', Buffer.from(`${word} notes`))
    db.insert(schema.agentAttachmentRefs).values({ attachmentId: attachment.id, turnId, position: 0 }).run()
    const artifact = await runtime.artifacts.putText({ sessionId: id, turnId, kind: 'command_output', title: 'Output', text: `${word} output` })
    const stored = db.select().from(schema.agentAttachments).where(eq(schema.agentAttachments.id, attachment.id)).get()!
    const output = db.select().from(schema.agentArtifacts).where(eq(schema.agentArtifacts.id, artifact.id)).get()!
    return {
      id,
      attachmentPath: join(runtime.attachments.root, stored.storageKey),
      artifactPath: join(runtime.artifacts.root, output.storageKey!),
    }
  }

  const count = (table: 'agent_events' | 'agent_turns' | 'agent_requests' | 'agent_artifacts', sessionId: string) =>
    db.get<{ n: number }>(sql`SELECT count(*) AS n FROM ${sql.identifier(table)} WHERE session_id = ${sessionId}`)!.n
  const indexed = (sessionId: string) =>
    db.get<{ n: number }>(sql`SELECT count(*) AS n FROM agent_events_fts WHERE session_id = ${sessionId}`)!.n
  const row = (sessionId: string) => db.select().from(schema.agentSessions).where(eq(schema.agentSessions.id, sessionId)).get()!
  const keep = (days: number) => writeAgentSessionDefaults(ctx.core.prefs, OWNER, { ...defaultAgentSessionDefaults(), keepArchivedHistoryDays: days })
  // A small batch, so a session takes several steps.
  const prune = () => removeExpiredHistory({
    runtime,
    prefs: ctx.core.prefs,
    userId: OWNER,
    archivedBefore: (before) => ctx.core.tasks.archivedBefore(before),
    signal: new AbortController().signal,
    batch: 2,
  })

  it('removes only the sessions of tasks archived past the limit, and keeps their rows', async () => {
    const old = await session(await task('old', 'archived', now - 100 * DAY), 'kettle')
    const recent = await session(await task('recent', 'archived', now - 10 * DAY), 'teapot')
    const active = await session(await task('active', 'active', null), 'saucer')
    // Archived long ago and then restored: restoring clears the archive date.
    const restored = await session(await task('restored', 'active', null), 'spoon')
    const untouched = [recent, active, restored].map(({ id }) => ({ id, events: count('agent_events', id), indexed: indexed(id) }))
    await keep(30)

    expect(await prune()).toBe('removed the history of 1 sessions (6 events)')

    const stub = row(old.id)
    expect(stub.historyRemovedAt).not.toBeNull()
    expect(stub.title).toBe('kettle session')
    const events = db.select().from(schema.agentEvents).where(eq(schema.agentEvents.sessionId, old.id)).all()
    expect(events).toHaveLength(1)
    expect(JSON.parse(events[0]!.eventJson)).toEqual({
      type: 'diagnostic',
      level: 'info',
      message: "Acorn removed this session's history because its task had been archived for more than 30 days.",
    })
    // The note takes the next sequence, so a reader resuming from a mark still reaches it.
    expect(events[0]!.seq).toBe(7)
    expect(stub.lastEventSeq).toBe(7)
    expect(stub.lastReadSeq).toBe(7)
    expect(stub.attention).toBe('none')
    expect(count('agent_turns', old.id)).toBe(0)
    expect(count('agent_requests', old.id)).toBe(0)
    expect(count('agent_artifacts', old.id)).toBe(0)
    expect(existsSync(old.artifactPath)).toBe(false)
    expect(existsSync(old.attachmentPath)).toBe(false)

    for (const before of untouched) {
      expect(row(before.id).historyRemovedAt).toBeNull()
      expect(count('agent_events', before.id)).toBe(before.events)
      expect(indexed(before.id)).toBe(before.indexed)
      expect(count('agent_turns', before.id)).toBe(1)
    }
    expect(existsSync(recent.artifactPath)).toBe(true)
    expect(existsSync(recent.attachmentPath)).toBe(true)
  })

  it('keeps the search index consistent with the events it indexes', async () => {
    const old = await session(await task('old', 'archived', now - 400 * DAY), 'kettle')
    await session(await task('recent', 'archived', now - 10 * DAY), 'teapot')
    await keep(365)
    await prune()

    // The note is the only row of the pruned session the index holds.
    expect(indexed(old.id)).toBe(1)
    const events = db.get<{ n: number }>(sql`SELECT count(*) AS n FROM agent_events WHERE search_text IS NOT NULL`)!.n
    const rows = db.get<{ n: number }>(sql`SELECT count(*) AS n FROM agent_events_fts`)!.n
    expect(rows).toBe(events)
    // Every search row still names the event that shares its rowid.
    const orphans = db.get<{ n: number }>(sql`
      SELECT count(*) AS n FROM agent_events_fts
      LEFT JOIN agent_events ON agent_events.rowid = agent_events_fts.rowid AND agent_events.id = agent_events_fts.event_id
      WHERE agent_events.id IS NULL
    `)!.n
    expect(orphans).toBe(0)
    expect(() => db.run(sql`INSERT INTO agent_events_fts (agent_events_fts) VALUES ('integrity-check')`)).not.toThrow()
    // The archive page's search no longer finds the removed conversation, and still finds the rest.
    expect(await runtime.store.searchTaskSessions('kettle bug', ['old', 'recent'], 10)).toEqual([])
    expect((await runtime.store.searchTaskSessions('teapot bug', ['old', 'recent'], 10)).map((hit) => hit.taskId)).toEqual(['recent'])
  })

  it('does nothing while the owner keeps history forever, which is the default', async () => {
    const old = await session(await task('old', 'archived', now - 1000 * DAY), 'kettle')
    const events = count('agent_events', old.id)

    expect(await prune()).toBe('agent history is kept forever')
    expect(count('agent_events', old.id)).toBe(events)
    expect(row(old.id).historyRemovedAt).toBeNull()
  })

  it('changes nothing the second time', async () => {
    const old = await session(await task('old', 'archived', now - 100 * DAY), 'kettle')
    await keep(90)
    await prune()
    const after = row(old.id)

    expect(await prune()).toBe('removed the history of 0 sessions (0 events)')
    expect(row(old.id)).toEqual(after)
    expect(count('agent_events', old.id)).toBe(1)
  })

  it('leaves a session with a turn in flight, or a provider process, for a later pass', async () => {
    const running = await session(await task('old', 'archived', now - 100 * DAY), 'kettle')
    const idle = await session('old', 'teapot')
    db.update(schema.agentTurns).set({ status: 'active' }).where(eq(schema.agentTurns.sessionId, running.id)).run()

    expect(runtime.store.sessionWithHistory(['old'], new Set([idle.id]))).toBeNull()
    expect(runtime.store.sessionWithHistory(['old'], new Set())).toBe(idle.id)
    await keep(30)
    await prune()
    expect(row(running.id).historyRemovedAt).toBeNull()
    expect(count('agent_events', running.id)).toBe(6)
  })

  it('stops at the signal and carries on next time', async () => {
    const old = await session(await task('old', 'archived', now - 100 * DAY), 'kettle')
    const controller = new AbortController()
    let asked = 0
    const result = await runtime.removeArchivedHistory({
      taskIds: async () => {
        // The second step finds the signal already fired.
        if (++asked === 2) controller.abort()
        return ['old']
      },
      note: 'Removed.',
      signal: controller.signal,
      batch: 2,
    })
    expect(result).toEqual({ sessions: 0, events: 2, complete: false })
    expect(row(old.id).historyRemovedAt).toBeNull()

    const rest = await runtime.removeArchivedHistory({ taskIds: async () => ['old'], note: 'Removed.', batch: 2 })
    expect(rest).toEqual({ sessions: 1, events: 4, complete: true })
  })

  it('leaves a task restored part-way through alone from the next step on', async () => {
    const old = await session(await task('old', 'archived', now - 100 * DAY), 'kettle')
    await keep(30)
    let asked = 0
    const result = await removeExpiredHistory({
      runtime,
      prefs: ctx.core.prefs,
      userId: OWNER,
      archivedBefore: async (before) => {
        // Restored after the first step.
        if (++asked === 2) await ctx.db.update(coreSchema.tasks).set({ status: 'active', archivedAt: null }).where(eq(coreSchema.tasks.id, 'old'))
        return ctx.core.tasks.archivedBefore(before)
      },
      signal: new AbortController().signal,
      batch: 2,
    })
    expect(result).toBe('removed the history of 0 sessions (2 events)')
    expect(row(old.id).historyRemovedAt).toBeNull()
    expect(count('agent_events', old.id)).toBe(4)
  })
})
