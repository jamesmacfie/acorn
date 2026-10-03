import { and, eq, inArray } from 'drizzle-orm'
import { taskScriptLogsInputSchema, taskScriptWaitInputSchema, taskScriptSettled, type TaskScriptLogs, type TaskScriptPhase, type TaskScriptReason, type TaskScriptSnapshot, type TaskScriptWait } from '@acorn/protocol/taskScripts.ts'
import { schema, type AppDatabase } from '../db'
import { TaskScriptStore, type AttemptIdentity } from './store'
import { utf8Tail } from './output'

export type ScriptEvidence =
  | { type: 'started'; terminalSessionId: string }
  | { type: 'output'; data: string }
  | { type: 'exit'; exitCode: number | null; signal?: number }
  | { type: 'failed'; reason: 'spawn_failed' | 'timeout' }
  | { type: 'interrupted'; reason: 'cancelled' | 'terminal_removed' | 'shutdown' | 'restart' | 'process_lost' }

export class TaskScriptService {
  readonly store: TaskScriptStore
  readonly shutdown = new AbortController()
  readonly recoveredSessions = new Set<string>()
  readonly pendingSetup = new Map<string, string>()
  constructor(db: AppDatabase) { this.store = new TaskScriptStore(db) }
  status(taskId: string) { return this.store.status(taskId) }
  select(taskId: string, phase: TaskScriptPhase, attemptId?: string) { return this.store.select(taskId, phase, attemptId) }
  newGeneration(taskId: string) {
    for (const attemptId of this.pendingSetup.keys()) {
      const row = this.store.db.select().from(schema.taskScriptAttempts).where(eq(schema.taskScriptAttempts.attemptId, attemptId)).get()
      if (row?.taskId === taskId) this.pendingSetup.delete(attemptId)
    }
    return this.store.newGeneration(taskId)
  }
  admit(taskId: string, phase: TaskScriptPhase, skip?: TaskScriptReason, publish = true) { return this.store.admit(taskId, phase, skip, publish) }
  prepareSetup(taskId: string, script: string | null, skip?: TaskScriptReason): TaskScriptSnapshot {
    const snapshot = this.admit(taskId, 'setup', skip)
    if (!skip && script) this.pendingSetup.set(snapshot.attemptId!, script)
    return snapshot
  }
  takeSetup(taskId: string): { identity: AttemptIdentity; script: string } | null {
    const current = this.select(taskId, 'setup')
    if (!current.attemptId || current.state !== 'starting') return null
    const script = this.pendingSetup.get(current.attemptId)
    if (!script) return null
    this.pendingSetup.delete(current.attemptId)
    return { identity: { attemptId: current.attemptId, generation: current.generation }, script }
  }
  report(identity: AttemptIdentity, evidence: ScriptEvidence): void {
    if (evidence.type === 'output') { this.store.output(identity, evidence.data); return }
    if (evidence.type === 'started') {
      const previous = this.store.db.select().from(schema.taskScriptAttempts).where(eq(schema.taskScriptAttempts.attemptId, identity.attemptId)).get()
      this.store.update(identity, { state: 'running', reason: 'process_started', terminalSessionId: evidence.terminalSessionId, startedAt: previous?.startedAt ?? Date.now(), outputAvailable: true })
    } else if (evidence.type === 'exit') {
      this.pendingSetup.delete(identity.attemptId)
      const interrupted = !!evidence.signal || evidence.exitCode === null
      this.store.update(identity, { state: interrupted ? 'interrupted' : evidence.exitCode === 0 ? 'succeeded' : 'failed',
        reason: interrupted ? 'process_lost' : evidence.exitCode === 0 ? 'exit_zero' : 'nonzero_exit',
        exitCode: evidence.exitCode, finishedAt: Date.now() })
    } else {
      this.pendingSetup.delete(identity.attemptId)
      this.store.update(identity, { state: evidence.type === 'failed' ? 'failed' : 'interrupted', reason: evidence.reason, finishedAt: Date.now() })
    }
  }
  logs(taskId: string, raw: unknown): TaskScriptLogs {
    const input = taskScriptLogsInputSchema.parse(raw)
    const snapshot = this.select(taskId, input.phase, input.attemptId)
    const row = snapshot.attemptId ? this.store.db.select().from(schema.taskScriptAttempts).where(eq(schema.taskScriptAttempts.attemptId, snapshot.attemptId)).get() : null
    const retained = row?.output ?? ''
    const lines = retained.split('\n')
    const count = input.tailLines + (retained.endsWith('\n') ? 1 : 0)
    const output = utf8Tail(lines.slice(-count).join('\n'), input.maxBytes)
    return { snapshot, output, available: snapshot.outputAvailable, truncated: snapshot.outputTruncated || output !== retained,
      retainedBytes: Buffer.byteLength(retained), returnedBytes: Buffer.byteLength(output) }
  }
  wait(taskId: string, raw: unknown, signal?: AbortSignal): Promise<TaskScriptWait> {
    const input = taskScriptWaitInputSchema.parse(raw)
    // Bind once. Explicit attempt reads can inspect history; a default wait cannot cross cycles.
    const selected = this.select(taskId, input.phase, input.attemptId)
    return new Promise((resolve, reject) => {
      let settled = false
      let timer: ReturnType<typeof setTimeout> | undefined
      const signals = [this.shutdown.signal, ...(signal ? [signal] : [])]
      const cleanup = () => {
        clearTimeout(timer)
        this.store.listeners.delete(check)
        for (const item of signals) item.removeEventListener('abort', abort)
      }
      const finish = (snapshot: TaskScriptSnapshot, matched: boolean, reason: TaskScriptWait['reason']) => {
        if (settled) return
        settled = true; cleanup(); resolve({ snapshot, matched, reason })
      }
      const fail = (error: unknown) => { if (!settled) { settled = true; cleanup(); reject(error) } }
      const abort = () => fail(signals.find(item => item.aborted)?.reason ?? new DOMException('Aborted', 'AbortError'))
      const read = () => {
        const current = this.select(taskId, input.phase, input.attemptId)
        if (current.generation !== selected.generation || !input.attemptId && current.attemptId !== selected.attemptId) {
          finish(current, false, 'generation_changed'); return null
        }
        return this.select(taskId, input.phase, selected.attemptId ?? undefined)
      }
      const check = (changedTaskId: string) => {
        if (settled || changedTaskId !== taskId) return
        try {
          const snapshot = read()
          if (!snapshot) return
          if (snapshot.reason === 'generation_changed') finish(snapshot, false, 'generation_changed')
          else if (taskScriptSettled(snapshot.state)) finish(snapshot, true, 'settled')
          else if (snapshot.state === 'not_started' || snapshot.state === 'unknown') finish(snapshot, false, snapshot.state)
        } catch (error) { fail(error) }
      }
      this.store.listeners.add(check)
      for (const item of signals) item.addEventListener('abort', abort, { once: true })
      if (signals.some(item => item.aborted)) { abort(); return }
      check(taskId)
      if (settled) return
      timer = setTimeout(() => {
        try { const snapshot = read(); if (snapshot) finish(snapshot, taskScriptSettled(snapshot.state), taskScriptSettled(snapshot.state) ? 'settled' : 'timeout') }
        catch (error) { fail(error) }
      }, input.timeoutMs)
    })
  }
  /** Called after the terminal owner has reattached recoverable sessions. */
  reconcile(liveSessionIds?: readonly string[]): void {
    if (liveSessionIds) { this.recoveredSessions.clear(); for (const id of liveSessionIds) this.recoveredSessions.add(id) }
    const live = this.recoveredSessions
    const rows = this.store.db.select().from(schema.taskScriptAttempts).where(inArray(schema.taskScriptAttempts.state, ['starting', 'running'])).all()
    for (const row of rows) {
      if (!row.terminalSessionId || !live.has(row.terminalSessionId)) this.report(row, { type: 'interrupted', reason: 'restart' })
    }
  }
  forSession(sessionId: string): AttemptIdentity | null {
    const row = this.store.db.select().from(schema.taskScriptAttempts).where(and(eq(schema.taskScriptAttempts.terminalSessionId, sessionId), inArray(schema.taskScriptAttempts.state, ['starting', 'running']))).get()
    return row ? { attemptId: row.attemptId, generation: row.generation } : null
  }
  interruptTask(taskId: string, reason: TaskScriptReason) { this.store.interruptTask(taskId, reason) }
  close(): void {
    this.shutdown.abort()
    for (const attemptId of this.pendingSetup.keys()) {
      const row = this.store.db.select().from(schema.taskScriptAttempts).where(eq(schema.taskScriptAttempts.attemptId, attemptId)).get()
      if (row) this.report(row, { type: 'interrupted', reason: 'shutdown' })
    }
    this.pendingSetup.clear()
  }
}
const services = new WeakMap<AppDatabase, TaskScriptService>()
export function taskScripts(db: AppDatabase): TaskScriptService {
  let service = services.get(db)
  if (!service) { service = new TaskScriptService(db); services.set(db, service) }
  return service
}
// First-party process evidence seam. Loaded plugins receive neither a ledger writer nor a DB handle.
export type TaskScriptEvidenceService = Pick<TaskScriptService, 'takeSetup' | 'report' | 'forSession' | 'reconcile' | 'close'>

/** Runtime projection: process owners receive no storage handle or worktree policy methods. */
export function taskScriptEvidence(db: AppDatabase): TaskScriptEvidenceService {
  const service = taskScripts(db)
  return {
    takeSetup: service.takeSetup.bind(service), report: service.report.bind(service),
    forSession: service.forSession.bind(service), reconcile: service.reconcile.bind(service),
    close: service.close.bind(service),
  }
}
