import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { AgentProviderDescriptor } from '@acorn/protocol/managedAgents.ts'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import { eq } from 'drizzle-orm'
import * as schema from '../../node/schema'
import { AgentStore } from '../sessions/store'
import { AgentDelegationStore, DelegationLimitError, delegationLimits } from './store'

const PROVIDER: AgentProviderDescriptor = {
  id: 'codex',
  profileId: 'codex',
  label: 'Codex',
  driverKind: 'codex-app-server',
  driverVersion: 'test',
  installed: true,
  authenticated: true,
  statusAuthority: 'protocol',
  capabilities: [],
  configOptions: [],
  commands: [],
  skills: [],
  diagnostics: [],
}

describe('agent delegation reservations', () => {
  let ctx: TestNodeContext
  let store: AgentDelegationStore
  let db: PluginDatabase

  beforeEach(() => {
    ctx = makeTestNodeContext({ plugin: { name: 'agents' } })
    db = ctx.storage.open()
    store = new AgentDelegationStore(db)
  })
  afterEach(() => ctx.cleanup())

  it('replays an owner-scoped call id without consuming another slot', () => {
    const first = store.reserveShared({ ownerTaskId: 'task-a', ownerSessionId: 'session-a', idempotencyKey: 'agent_spawn:call-1' })
    const replay = store.reserveShared({ ownerTaskId: 'task-a', ownerSessionId: 'session-a', idempotencyKey: 'agent_spawn:call-1' })
    expect(replay).toEqual({ spawn: first.spawn, created: false })
  })

  it('allocates and persists a stable intended task id with worktree recovery input', async () => {
    const provisioning = {
      title: 'Child',
      prompt: 'Inspect.',
      branch: 'Child',
      providerId: 'codex',
      profileId: 'codex',
      parentSessionId: null,
      parentTurnId: null,
      toolCeiling: { allow: ['agent_read'], maxRisk: 'execute' as const },
    }
    const first = store.reserveWorktree({
      ownerTaskId: 'task-a',
      ownerSessionId: 'session-a',
      idempotencyKey: 'agent_spawn:worktree',
      provisioning,
    })
    const replay = store.reserveWorktree({
      ownerTaskId: 'task-a',
      ownerSessionId: 'session-a',
      idempotencyKey: 'agent_spawn:worktree',
      provisioning: { ...provisioning, title: 'Ignored retry' },
    })

    expect(first.spawn.childTaskId).toMatch(/^[0-9a-f-]{36}$/)
    expect(first.spawn).toMatchObject({ isolation: 'worktree', provisioning })
    expect(replay).toEqual({ spawn: first.spawn, created: false })
    expect(await store.creatingWorktrees()).toEqual([first.spawn])
  })

  it('inherits root lineage and refuses a third delegation level', async () => {
    const first = store.reserveShared({ ownerTaskId: 'task-a', ownerSessionId: 'root', idempotencyKey: 'agent_spawn:first' }).spawn
    await store.complete(first.id, 'child-one', 'turn-one')
    const second = store.reserveShared({ ownerTaskId: 'task-a', ownerSessionId: 'child-one', idempotencyKey: 'agent_spawn:second' }).spawn
    await store.complete(second.id, 'child-two', 'turn-two')

    expect(second).toMatchObject({
      rootTaskId: 'task-a',
      rootSessionId: 'root',
      parentSpawnId: first.id,
      depth: 2,
    })
    expect(() => store.reserveShared({
      ownerTaskId: 'task-a',
      ownerSessionId: 'child-two',
      idempotencyKey: 'agent_spawn:third',
    })).toThrow(DelegationLimitError)
  })

  it('atomically admits no more than twelve concurrent creating descendants', async () => {
    const attempts = await Promise.allSettled(Array.from(
      { length: delegationLimits.maxLiveDescendants + 4 },
      (_, index) => Promise.resolve().then(() => store.reserveShared({
        ownerTaskId: 'task-a',
        ownerSessionId: 'root',
        idempotencyKey: `agent_spawn:${index}`,
      })),
    ))
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(delegationLimits.maxLiveDescendants)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(4)
    expect(attempts.filter((attempt) => attempt.status === 'rejected').every((attempt) =>
      attempt.status === 'rejected'
      && attempt.reason instanceof DelegationLimitError
      && attempt.reason.code === 'live_limit')).toBe(true)
  })

  it('counts provisioned nonterminal sessions and releases their slots only at terminal state', async () => {
    const sessions = new AgentStore(db, ctx.core)
    const children: string[] = []
    for (let index = 0; index < delegationLimits.maxLiveDescendants; index++) {
      const spawn = store.reserveShared({
        ownerTaskId: 'task-a',
        ownerSessionId: 'root',
        idempotencyKey: `agent_spawn:${index}`,
      }).spawn
      const child = await sessions.createSession({
        taskId: 'task-a',
        providerId: 'codex',
        profileId: 'codex',
        kind: 'delegated',
        config: {},
      }, PROVIDER)
      children.push(child.id)
      await store.complete(spawn.id, child.id, `turn-${index}`)
    }
    expect(() => store.reserveShared({
      ownerTaskId: 'task-a',
      ownerSessionId: 'root',
      idempotencyKey: 'agent_spawn:blocked',
    })).toThrow(DelegationLimitError)

    await db.update(schema.agentSessions)
      .set({ runtimeState: 'stopped' })
      .where(eq(schema.agentSessions.id, children[0]!))
    expect(store.reserveShared({
      ownerTaskId: 'task-a',
      ownerSessionId: 'root',
      idempotencyKey: 'agent_spawn:replacement',
    }).created).toBe(true)
  })

  it('projects creating lineage by spawn id but never across a task boundary', async () => {
    const spawn = store.reserveShared({
      ownerTaskId: 'task-a',
      ownerSessionId: 'terminal-a',
      idempotencyKey: 'agent_spawn:visible',
    }).spawn
    const sessions = new AgentStore(db, ctx.core)
    const sameTask = await sessions.createSession({
      taskId: 'task-a',
      providerId: 'codex',
      profileId: 'codex',
      kind: 'delegated',
      config: { delegationSpawnId: spawn.id },
    }, PROVIDER)
    const otherTask = await sessions.createSession({
      taskId: 'task-b',
      providerId: 'codex',
      profileId: 'codex',
      kind: 'delegated',
      config: { delegationSpawnId: spawn.id },
    }, PROVIDER)

    expect(await store.visibilityForSessions([sameTask])).toEqual([{
      sessionId: sameTask.id,
      ownerTaskId: 'task-a',
      ownerSessionId: 'terminal-a',
      managedParentSessionId: null,
      depth: 1,
      isolation: 'shared',
    }])
    expect(await store.visibilityForSessions([otherTask])).toEqual([])
  })
})
