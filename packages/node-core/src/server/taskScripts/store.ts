import { isTaskArchiving } from '../worktrees/archiveGate'
import { randomUUID } from 'node:crypto'
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { taskScriptSnapshotSchema, type TaskScriptPhase, type TaskScriptReason, type TaskScriptSnapshot, type TaskScriptsStatus } from '@acorn/protocol/taskScripts.ts'
import { BridgeError } from '../bridge'
import { schema, type AppDatabase } from '../db'
import { broadcastTasksChanged } from '../notify'
import { appendOutput } from './output'

export type AttemptIdentity = { attemptId: string; generation: number }
type Row = typeof schema.taskScriptAttempts.$inferSelect
const attempts = schema.taskScriptAttempts
const active = ['starting', 'running']
const snapshots = (row: Row): TaskScriptSnapshot => taskScriptSnapshotSchema.parse(row)

/** Synchronous SQLite operations keep process evidence ordered, including immediate exits. */
export class TaskScriptStore {
  readonly listeners = new Set<(taskId: string) => void>()
  constructor(readonly db: AppDatabase) {}
  changed(taskId: string, publish = true): void {
    // Writes have committed before a notice reaches any in-process or remote reader.
    for (const listener of this.listeners) listener(taskId)
    if (publish) broadcastTasksChanged({ taskId })
  }
  task(taskId: string) {
    const task = this.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()
    if (!task) throw new BridgeError(404, 'not_found', 'Task not found.')
    return task
  }
  select(taskId: string, phase: TaskScriptPhase, attemptId?: string): TaskScriptSnapshot {
    const task = this.task(taskId)
    const row = this.db.select().from(attempts).where(and(eq(attempts.taskId, taskId), eq(attempts.phase, phase),
      attemptId ? eq(attempts.attemptId, attemptId) : eq(attempts.generation, task.scriptGeneration)))
      .orderBy(desc(attempts.requestedAt), desc(sql`rowid`)).get()
    if (row) return snapshots(row)
    if (attemptId) throw new BridgeError(404, 'not_found', 'Script attempt not found.')
    const unknown = !task.scriptHistoryKnown || !!task.worktreePath && phase === 'setup'
    return { taskId, phase, generation: task.scriptGeneration, attemptId: null,
      state: unknown ? 'unknown' : 'not_started', reason: unknown ? 'legacy_history' : 'not_requested',
      terminalSessionId: null, requestedAt: null, startedAt: null, finishedAt: null, exitCode: null,
      outputAvailable: false, outputTruncated: false }
  }
  status(taskId: string): TaskScriptsStatus {
    const task = this.task(taskId)
    const rows = this.db.select().from(attempts).where(eq(attempts.taskId, taskId)).orderBy(desc(attempts.requestedAt), desc(sql`rowid`)).limit(51).all()
    return { taskId, generation: task.scriptGeneration, archiveInProgress: isTaskArchiving(taskId), setup: this.select(taskId, 'setup'), teardown: this.select(taskId, 'teardown'),
      attempts: rows.slice(0, 50).map(snapshots), attemptsTruncated: rows.length > 50 }
  }
  newGeneration(taskId: string): number {
    const generation = this.db.transaction((tx) => {
      const task = tx.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).get()
      if (!task) throw new BridgeError(404, 'not_found', 'Task not found.')
      tx.update(attempts).set({ state: 'interrupted', reason: 'generation_changed', finishedAt: Date.now() })
        .where(and(eq(attempts.taskId, taskId), inArray(attempts.state, active))).run()
      tx.update(schema.tasks).set({ scriptGeneration: task.scriptGeneration + 1, scriptHistoryKnown: true }).where(eq(schema.tasks.id, taskId)).run()
      return task.scriptGeneration + 1
    })
    this.changed(taskId)
    return generation
  }
  admit(taskId: string, phase: TaskScriptPhase, skip?: TaskScriptReason, publish = true): TaskScriptSnapshot {
    const task = this.task(taskId)
    const at = Date.now()
    const row = this.db.insert(attempts).values({ attemptId: randomUUID(), taskId, phase, generation: task.scriptGeneration,
      state: skip ? 'skipped' : 'starting', reason: skip ?? 'admitted', requestedAt: at, finishedAt: skip ? at : null }).returning().get()
    this.changed(taskId, publish)
    return snapshots(row)
  }
  update(identity: AttemptIdentity, change: Partial<Row>): void {
    const row = this.db.select().from(attempts).where(and(eq(attempts.attemptId, identity.attemptId), eq(attempts.generation, identity.generation))).get()
    if (!row || !active.includes(row.state)) return
    const task = this.db.select().from(schema.tasks).where(eq(schema.tasks.id, row.taskId)).get()
    if (!task || task.scriptGeneration !== identity.generation) return
    this.db.update(attempts).set(change).where(eq(attempts.attemptId, row.attemptId)).run()
    this.changed(row.taskId)
  }
  output(identity: AttemptIdentity, data: string): void {
    const row = this.db.select().from(attempts).where(and(eq(attempts.attemptId, identity.attemptId), eq(attempts.generation, identity.generation))).get()
    if (!row || !active.includes(row.state)) return
    const tail = appendOutput(row.output, data)
    this.db.update(attempts).set({ output: tail.output, outputAvailable: true, outputTruncated: row.outputTruncated || tail.truncated })
      .where(eq(attempts.attemptId, identity.attemptId)).run()
    // Output does not wake status queries or waits at machine rate.
  }
  interruptTask(taskId: string, reason: TaskScriptReason): void {
    const rows = this.db.select().from(attempts).where(and(eq(attempts.taskId, taskId), inArray(attempts.state, active))).all()
    for (const row of rows) this.update(row, { state: 'interrupted', reason, finishedAt: Date.now() })
  }
}
