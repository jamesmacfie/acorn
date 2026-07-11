import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { z } from 'zod'
import { type AppDatabase, schema } from '../../../core/server/db'
import { taskRoot } from '../../../core/main/taskWorktree'
import { PublicApiError } from '../../../core/shared/publicApi/errors'
import type { CreateExecutionSchema, ExecutionSchema } from '../../../core/shared/publicApi/terminal'

// Captured command executions (docs/next/api/terminal-git-files.md §4). A bounded, queryable command
// result for headless automation. Runs a shell-shaped command in the task's confined worktree with
// a timeout + output cap; Acorn secrets are stripped from the inherited environment (§1).

type Execution = z.infer<typeof ExecutionSchema>
type ExecutionRow = typeof schema.commandExecutions.$inferSelect

// Never inherited by a public ad-hoc command (§1).
const SECRET_ENV_KEYS = new Set(['INTERNAL_TOKEN', 'SESSION_ENC_KEY', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'ACORN_API_TOKEN', 'ACORN_INTERNAL_TOKEN'])

function cleanBaseEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {}
  for (const [k, v] of Object.entries(process.env)) if (!SECRET_ENV_KEYS.has(k)) out[k] = v
  return out
}

function rowToExecution(row: ExecutionRow, includeOutput: boolean): Execution {
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status as Execution['status'],
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    exitCode: row.exitCode,
    signal: row.signal,
    outputTruncated: row.outputTruncated,
    ...(includeOutput ? { stdout: row.stdout, stderr: row.stderr } : {}),
  }
}

export class CommandExecutionService {
  private readonly running = new Map<string, ChildProcess>()

  constructor(private readonly db: AppDatabase) {}

  async create(taskId: string, input: z.infer<typeof CreateExecutionSchema>): Promise<Execution> {
    const cwd = await taskRoot(this.db, taskId)
    if (!cwd) throw new PublicApiError('conflict', 'Task has no worktree yet')
    const id = randomUUID()
    const now = Date.now()
    await this.db.insert(schema.commandExecutions).values({
      id, taskId, status: 'running', stdout: '', stderr: '', outputTruncated: false, timeoutMs: input.timeoutMs,
      createdAt: now, startedAt: now, completedAt: null, exitCode: null, signal: null,
    })
    this.run(id, cwd, input)
    const [row] = await this.db.select().from(schema.commandExecutions).where(eq(schema.commandExecutions.id, id)).limit(1)
    return rowToExecution(row, false)
  }

  // Spawn in the background; the row is updated on completion so an HTTP client can poll GET.
  private run(id: string, cwd: string, input: z.infer<typeof CreateExecutionSchema>): void {
    const shell = process.env.SHELL || '/bin/sh'
    const child = spawn(shell, ['-c', input.command], { cwd, env: { ...cleanBaseEnv(), ...input.env } })
    this.running.set(id, child)

    let stdout = ''
    let stderr = ''
    let truncated = false
    const cap = (buf: string, chunk: Buffer): string => {
      if (Buffer.byteLength(buf) >= input.maxOutputBytes) {
        truncated = true
        return buf
      }
      const next = buf + chunk.toString()
      if (Buffer.byteLength(next) > input.maxOutputBytes) {
        truncated = true
        return next.slice(0, input.maxOutputBytes)
      }
      return next
    }
    child.stdout?.on('data', (c: Buffer) => (stdout = cap(stdout, c)))
    child.stderr?.on('data', (c: Buffer) => (stderr = cap(stderr, c)))

    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, input.timeoutMs)

    child.on('close', (code, signal) => {
      clearTimeout(timer)
      this.running.delete(id)
      const cancelled = !timedOut && signal === 'SIGTERM'
      const status: Execution['status'] = timedOut ? 'timed-out' : cancelled ? 'cancelled' : code === 0 ? 'succeeded' : 'failed'
      void this.db
        .update(schema.commandExecutions)
        .set({ status, stdout, stderr, outputTruncated: truncated, exitCode: code, signal: signal ?? null, completedAt: Date.now() })
        .where(eq(schema.commandExecutions.id, id))
        .catch(() => {})
    })
    child.on('error', () => {
      clearTimeout(timer)
      this.running.delete(id)
      void this.db
        .update(schema.commandExecutions)
        .set({ status: 'failed', stderr: 'failed to spawn command', completedAt: Date.now() })
        .where(eq(schema.commandExecutions.id, id))
        .catch(() => {})
    })
  }

  async get(id: string, includeOutput: boolean): Promise<Execution> {
    const [row] = await this.db.select().from(schema.commandExecutions).where(eq(schema.commandExecutions.id, id)).limit(1)
    if (!row) throw new PublicApiError('not_found', 'Execution not found')
    return rowToExecution(row, includeOutput)
  }

  async cancel(id: string): Promise<Execution> {
    const child = this.running.get(id)
    if (child) child.kill('SIGTERM')
    return this.get(id, false)
  }
}
