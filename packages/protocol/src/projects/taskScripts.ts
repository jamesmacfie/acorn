import { z } from 'zod'

export const TASK_SCRIPT_OUTPUT_BYTES = 64 * 1024
export const TASK_SCRIPT_QUERY_BYTES = 32 * 1024
export const TASK_SCRIPT_WAIT_MS = 30_000
export const taskScriptPhaseSchema = z.enum(['setup', 'teardown'])
export const taskScriptStateSchema = z.enum(['not_started', 'starting', 'running', 'succeeded', 'failed', 'skipped', 'interrupted', 'unknown'])
export const taskScriptReasonSchema = z.enum([
  'not_requested', 'legacy_history', 'admitted', 'process_started', 'exit_zero', 'nonzero_exit',
  'spawn_failed', 'timeout', 'user_skipped', 'disabled', 'not_configured', 'not_applicable',
  'cancelled', 'terminal_removed', 'shutdown', 'restart', 'process_lost', 'generation_changed',
])
export const taskScriptSnapshotSchema = z.object({
  taskId: z.string(), phase: taskScriptPhaseSchema, generation: z.number().int(),
  attemptId: z.string().nullable(), state: taskScriptStateSchema, reason: taskScriptReasonSchema,
  terminalSessionId: z.string().nullable(), requestedAt: z.number().nullable(),
  startedAt: z.number().nullable(), finishedAt: z.number().nullable(), exitCode: z.number().int().nullable(),
  outputAvailable: z.boolean(), outputTruncated: z.boolean(),
})
export const taskScriptsStatusSchema = z.object({
  taskId: z.string(), generation: z.number().int(), archiveInProgress: z.boolean(), setup: taskScriptSnapshotSchema, teardown: taskScriptSnapshotSchema,
  // Whether a person can start setup by hand now. The node decides, so a client gate needs no rules.
  setupRunnable: z.boolean(), attempts: z.array(taskScriptSnapshotSchema), attemptsTruncated: z.boolean(),
})
export const taskScriptSelectionSchema = z.strictObject({ phase: taskScriptPhaseSchema, attemptId: z.string().min(1).max(200).optional() })
export const taskScriptWaitInputSchema = taskScriptSelectionSchema.extend({ timeoutMs: z.number().int().min(0).max(TASK_SCRIPT_WAIT_MS).default(TASK_SCRIPT_WAIT_MS) })
export const taskScriptLogsInputSchema = taskScriptSelectionSchema.extend({
  tailLines: z.number().int().min(1).max(1000).default(100),
  maxBytes: z.number().int().min(1).max(TASK_SCRIPT_QUERY_BYTES).default(TASK_SCRIPT_QUERY_BYTES),
})
export const taskScriptWaitSchema = z.object({
  snapshot: taskScriptSnapshotSchema, matched: z.boolean(),
  reason: z.enum(['settled', 'not_started', 'unknown', 'timeout', 'generation_changed']),
})
export const taskScriptLogsSchema = z.object({
  snapshot: taskScriptSnapshotSchema, output: z.string(), available: z.boolean(), truncated: z.boolean(),
  retainedBytes: z.number().int(), returnedBytes: z.number().int(),
})
export type TaskScriptPhase = z.infer<typeof taskScriptPhaseSchema>
export type TaskScriptState = z.infer<typeof taskScriptStateSchema>
export type TaskScriptReason = z.infer<typeof taskScriptReasonSchema>
export type TaskScriptSnapshot = z.infer<typeof taskScriptSnapshotSchema>
export type TaskScriptsStatus = z.infer<typeof taskScriptsStatusSchema>
export type TaskScriptWaitInput = z.infer<typeof taskScriptWaitInputSchema>
export type TaskScriptLogsInput = z.infer<typeof taskScriptLogsInputSchema>
export type TaskScriptWait = z.infer<typeof taskScriptWaitSchema>
export type TaskScriptLogs = z.infer<typeof taskScriptLogsSchema>
export const taskScriptsRoute = (id: string) => `/v1/core/tasks/${encodeURIComponent(id)}/scripts`
export const taskScriptsKey = ['task-scripts', 'v1'] as const
export const taskScriptSettled = (state: TaskScriptState): boolean => ['succeeded', 'failed', 'skipped', 'interrupted'].includes(state)
export const taskScriptAcceptable = (snapshot: TaskScriptSnapshot): boolean => snapshot.state === 'succeeded'
  || snapshot.state === 'skipped' && ['user_skipped', 'disabled', 'not_configured', 'not_applicable'].includes(snapshot.reason)
