import { z } from 'zod'
import { IdSchema, OwnerSchema, PageQuerySchema, RepoNameSchema, UnixMillisSchema } from './primitives'

// Terminal plugin public schemas (docs/public-api.md). This file covers the
// captured-execution resource + profiles. Interactive sessions + streaming are a separate surface.

export const EnvironmentSchema = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(64_000))
  .refine((v) => Object.keys(v).length <= 200, 'at most 200 environment variables')

export const CreateExecutionSchema = z.strictObject({
  command: z.string().min(1).max(100_000),
  env: EnvironmentSchema.default({}),
  timeoutMs: z.number().int().min(100).max(3_600_000).default(120_000),
  maxOutputBytes: z.number().int().min(1_024).max(10_485_760).default(1_048_576),
})

export const ExecutionSchema = z.strictObject({
  id: IdSchema,
  taskId: IdSchema,
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'cancelled', 'timed-out']),
  createdAt: UnixMillisSchema,
  startedAt: UnixMillisSchema.nullable(),
  completedAt: UnixMillisSchema.nullable(),
  exitCode: z.number().int().nullable(),
  signal: z.string().nullable(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  outputTruncated: z.boolean(),
})

export const ExecutionQuerySchema = z.strictObject({ includeOutput: z.enum(['true', 'false']).default('false') })

export const TerminalProfileSchema = z.strictObject({
  id: z.string().min(1).max(100),
  label: z.string(),
  kind: z.enum(['shell', 'agent']),
  available: z.boolean(),
  tmuxMissing: z.boolean().optional(),
})

// Interactive terminal sessions (docs/public-api.md).
export const AgentStateSchema = z.enum(['starting', 'working', 'waiting', 'idle', 'blocked', 'permission', 'done', 'unknown'])

export const TerminalSessionSchema = z.strictObject({
  id: IdSchema,
  taskId: IdSchema,
  title: z.string(),
  kind: z.enum(['shell', 'agent']),
  profileId: z.string(),
  backend: z.enum(['node-pty', 'tmux']),
  status: z.enum(['running', 'exited']),
  idle: z.boolean(),
  agentState: AgentStateSchema,
  isWorktree: z.boolean(),
  cwd: z.string(),
  commandLabel: z.string(), // redacted/display label, never the raw command
  tmuxSession: z.string().optional(),
  repo: z.strictObject({ owner: OwnerSchema, name: RepoNameSchema }).optional(),
  pull: z.strictObject({ number: z.number().int().positive() }).optional(),
  cols: z.number().int().min(1).max(1000),
  rows: z.number().int().min(1).max(1000),
  createdAt: UnixMillisSchema,
  exitedAt: UnixMillisSchema.nullable(),
  exitCode: z.number().int().nullable(),
})

const EnvironmentSchema2 = z
  .record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(64_000))
  .refine((v) => Object.keys(v).length <= 200)

export const CreateTerminalSessionSchema = z.discriminatedUnion('launch', [
  z.strictObject({
    launch: z.literal('profile'),
    profileId: z.string().min(1).max(100).default('shell'),
    title: z.string().trim().min(1).max(240).optional(),
    cols: z.number().int().min(1).max(1000).default(120),
    rows: z.number().int().min(1).max(1000).default(40),
  }),
  z.strictObject({
    launch: z.literal('command'),
    command: z.string().min(1).max(100_000),
    env: EnvironmentSchema2.default({}),
    title: z.string().trim().min(1).max(240).optional(),
    durable: z.boolean().default(true),
    cols: z.number().int().min(1).max(1000).default(120),
    rows: z.number().int().min(1).max(1000).default(40),
  }),
])

export const SessionsQuerySchema = PageQuerySchema.extend({
  taskId: IdSchema.optional(),
  status: z.enum(['running', 'exited']).optional(),
  kind: z.enum(['shell', 'agent']).optional(),
})

export const ResizeTerminalSchema = z.strictObject({ cols: z.number().int().min(1).max(1000), rows: z.number().int().min(1).max(1000) })
export const SendToAgentSchema = z.strictObject({ text: z.string().min(1).max(1_000_000), submit: z.enum(['now', 'after-ready', 'draft']) })
export const AgentSendResultSchema = z.strictObject({ sent: z.boolean(), queued: z.boolean(), reason: z.string().optional() })
export const DeleteSessionQuerySchema = z.strictObject({ force: z.enum(['true', 'false']).default('false') })

// MCP inspection (§5) — never exposes environment secret VALUES, only the variable names.
export const McpServerSummarySchema = z.strictObject({
  name: z.string(),
  transport: z.enum(['stdio', 'http', 'unknown']),
  status: z.enum(['enabled', 'disabled', 'invalid']),
  command: z.string().optional(),
  url: z.string().optional(),
  envKeys: z.array(z.string()),
})
export const McpInspectSchema = z.strictObject({ files: z.array(z.strictObject({ file: z.string(), servers: z.array(McpServerSummarySchema) })) })
export const McpStarterResultSchema = z.strictObject({ created: z.boolean(), reason: z.string().optional() })

export const WorktreeStatusSchema = z.strictObject({
  taskId: IdSchema,
  worktreePath: z.string().nullable(),
  isWorktree: z.boolean(),
  branch: z.string().nullable(),
  dirty: z.boolean(),
  dirtyCount: z.number().int().nonnegative(),
  missing: z.boolean(),
})

export const WorktreeRemoveQuerySchema = z.strictObject({ force: z.enum(['true', 'false']).default('false') })

// Local checkout mapping + run targets (docs/public-api.md).
export const RunTargetSchema = z.strictObject({
  id: z.string().min(1).max(100),
  command: z.string().min(1).max(100_000),
  stop: z.string().max(100_000).optional(),
  restart: z.string().max(100_000).optional(),
  url: z.url().optional(),
  urlCommand: z.string().max(100_000).optional(),
  icon: z.string().max(100).optional(),
  default: z.boolean().optional(),
})

export const RepoPathSchema = z.strictObject({
  owner: z.string(),
  repo: z.string(),
  path: z.string(),
  runTargets: z.array(RunTargetSchema).max(100),
})

export const PutRepoPathSchema = z.strictObject({ path: z.string().min(1).max(4096) })
export const PutRunTargetsSchema = z.strictObject({ runTargets: z.array(RunTargetSchema).max(100) })
