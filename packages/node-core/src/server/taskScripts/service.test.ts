import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../bindings'
import { makeTestDb, type TestDb } from '../../testkit/db'
import { schema } from '../db'
import { TaskScriptService } from './service'

let db: TestDb
let scripts: TaskScriptService
beforeEach(() => {
  db = makeTestDb()
  db.db.insert(schema.tasks).values({ id: 'task', title: 'Fixture', projectId: 'p', origin: 'local', status: 'active', createdAt: 1, updatedAt: 1 }).run()
  scripts = new TaskScriptService(db.db)
})
afterEach(() => { scripts.close(); db.cleanup() })
const admit = (phase: 'setup' | 'teardown' = 'setup') => { const row = scripts.admit('task', phase); return { attemptId: row.attemptId!, generation: row.generation } }

describe('durable task script contract', () => {
  it('does not invent an execution or start work on reads', async () => {
    expect(scripts.status('task').setup).toMatchObject({ state: 'not_started', attemptId: null, requestedAt: null })
    expect(await scripts.wait('task', { phase: 'setup' })).toMatchObject({ matched: false, reason: 'not_started' })
    expect(scripts.logs('task', { phase: 'setup' })).toMatchObject({ available: false, output: '' })
    db.db.update(schema.tasks).set({ scriptHistoryKnown: false, worktreePath: '/legacy' }).where(eq(schema.tasks.id, 'task')).run()
    expect(scripts.status('task').setup).toMatchObject({ state: 'unknown', reason: 'legacy_history', requestedAt: null })
    expect(await scripts.wait('task', { phase: 'setup' })).toMatchObject({ matched: false, reason: 'unknown' })
    expect(scripts.status('task').attempts).toEqual([])
  })
  it('captures an immediate confirmed exit and preserves it across readers and configuration changes', async () => {
    const id = admit()
    const wait = scripts.wait('task', { phase: 'setup' })
    scripts.report(id, { type: 'started', terminalSessionId: 'session' })
    scripts.report(id, { type: 'output', data: 'installed ✓\n' })
    scripts.report(id, { type: 'exit', exitCode: 0 })
    expect(await wait).toMatchObject({ matched: true, snapshot: { state: 'succeeded', exitCode: 0 } })
    scripts.report(id, { type: 'interrupted', reason: 'terminal_removed' })
    db.db.update(schema.tasks).set({ skipSetup: true }).where(eq(schema.tasks.id, 'task')).run()
    const reopened = new TaskScriptService(db.db)
    expect(reopened.status('task').setup).toMatchObject({ state: 'succeeded', terminalSessionId: 'session' })
    expect(reopened.logs('task', { phase: 'setup' })).toMatchObject({ output: 'installed ✓\n', available: true })
    expect(scripts.store.listeners.size).toBe(0)
  })
  it.each(['spawn_failed', 'timeout'] as const)('records %s without a fabricated exit code', reason => {
    const id = admit()
    scripts.report(id, { type: 'failed', reason })
    expect(scripts.status('task').setup).toMatchObject({ state: 'failed', reason, exitCode: null })
  })
  it('distinguishes nonzero exit, unavailable exit, and every intentional skip', async () => {
    let id = admit()
    scripts.report(id, { type: 'exit', exitCode: 1 })
    expect(scripts.status('task').setup).toMatchObject({ state: 'failed', reason: 'nonzero_exit', exitCode: 1 })
    id = admit()
    scripts.report(id, { type: 'exit', exitCode: null })
    expect(scripts.status('task').setup.state).toBe('interrupted')
    for (const reason of ['user_skipped', 'disabled', 'not_configured', 'not_applicable'] as const) {
      scripts.admit('task', 'setup', reason)
      expect(await scripts.wait('task', { phase: 'setup' })).toMatchObject({ matched: true, snapshot: { state: 'skipped', reason, startedAt: null, exitCode: null } })
    }
  })
  it('binds waits to a generation and fences late exits from prior attempts', async () => {
    const old = admit()
    const wait = scripts.wait('task', { phase: 'setup' })
    scripts.newGeneration('task')
    expect(await wait).toMatchObject({ matched: false, reason: 'generation_changed' })
    const current = admit()
    scripts.report(old, { type: 'exit', exitCode: 0 })
    expect(scripts.status('task').setup).toMatchObject({ attemptId: current.attemptId, state: 'starting' })
    expect(scripts.logs('task', { phase: 'setup', attemptId: old.attemptId }).snapshot).toMatchObject({ state: 'interrupted', reason: 'generation_changed' })
    expect(scripts.status('task').attempts).toHaveLength(2)
  })
  it('timeout and cancellation release wait resources and keep the process running', async () => {
    const id = admit()
    scripts.report(id, { type: 'started', terminalSessionId: 'session' })
    expect(await scripts.wait('task', { phase: 'setup', timeoutMs: 0 })).toMatchObject({ matched: false, reason: 'timeout', snapshot: { state: 'running' } })
    const abort = new AbortController()
    const wait = scripts.wait('task', { phase: 'setup' }, abort.signal)
    abort.abort()
    await expect(wait).rejects.toThrow()
    expect(scripts.store.listeners.size).toBe(0)
    expect(scripts.status('task').setup.state).toBe('running')
  })
  it('recovers only known live process identities and interrupts unrecoverable starts', () => {
    const live = admit()
    scripts.report(live, { type: 'started', terminalSessionId: 'live' })
    const lost = admit('teardown')
    scripts.report(lost, { type: 'started', terminalSessionId: 'lost' })
    const reopened = new TaskScriptService(db.db)
    reopened.reconcile(['live'])
    expect(reopened.status('task').setup.state).toBe('running')
    expect(reopened.status('task').teardown).toMatchObject({ state: 'interrupted', reason: 'restart' })
    reopened.reconcile([])
    expect(reopened.status('task').setup).toMatchObject({ state: 'interrupted', exitCode: null })
  })
  it('bounds UTF-8 tails by lines and bytes, reports truncation, and confines attempt lookups', () => {
    const id = admit()
    scripts.report(id, { type: 'output', data: 'α'.repeat(100000) + '\none\ntwo\nthree\n' })
    const logs = scripts.logs('task', { phase: 'setup', tailLines: 2, maxBytes: 9 })
    expect(logs).toMatchObject({ output: 'wo\nthree\n', available: true, truncated: true, returnedBytes: 9 })
    expect(logs.retainedBytes).toBeLessThanOrEqual(65536)
    expect(logs.output).not.toContain('�')
    expect(() => scripts.logs('task', { phase: 'teardown', attemptId: id.attemptId })).toThrow('not found')
    expect(() => scripts.logs('other', { phase: 'setup', attemptId: id.attemptId })).toThrow('not found')
    expect(() => scripts.wait('task', { phase: 'setup', timeoutMs: 30001 })).toThrow()
  })
})

it('keeps completed diagnostics across an actual SQLite close and Node service reopen', () => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-script-reopen-'))
  const path = join(dir, 'core.sqlite')
  let connection = openDb(path)
  try {
    connection.insert(schema.tasks).values({ id: 'durable', title: 'Fixture', projectId: 'p', origin: 'local', status: 'active', createdAt: 1, updatedAt: 1 }).run()
    const first = new TaskScriptService(connection)
    const row = first.admit('durable', 'setup')
    const identity = { attemptId: row.attemptId!, generation: row.generation }
    first.report(identity, { type: 'started', terminalSessionId: 'gone' })
    first.report(identity, { type: 'output', data: 'installed\n' })
    first.report(identity, { type: 'exit', exitCode: 0 })
    first.close(); connection.close()
    connection = openDb(path)
    const second = new TaskScriptService(connection)
    second.reconcile([])
    expect(second.status('durable').setup).toMatchObject({ attemptId: identity.attemptId, state: 'succeeded', exitCode: 0 })
    expect(second.logs('durable', { phase: 'setup' })).toMatchObject({ available: true, output: 'installed\n' })
    second.close()
  } finally { connection.close(); rmSync(dir, { recursive: true, force: true }) }
})
