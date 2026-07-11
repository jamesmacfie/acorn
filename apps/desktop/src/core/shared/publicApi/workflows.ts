import { z } from 'zod'
import { IdSchema, PageQuerySchema, UnixMillisSchema } from './primitives'

// Workflows plugin public schemas (docs/public-api.md). Runs/steps parse the durable
// JSON columns into typed values — never raw JSON strings.

const RunStatus = z.enum(['running', 'gated', 'cancelling', 'done', 'failed', 'safety-rail', 'cancelled'])
const StepStatus = z.enum(['pending', 'running', 'waiting-gate', 'done', 'failed', 'skipped', 'safety-rail', 'cancelled'])
const Posture = z.enum(['gated', 'autonomous'])

export const WorkflowDefinitionSchema = z.strictObject({
  id: z.string(),
  name: z.string(),
  source: z.enum(['repo', 'user']),
  posture: Posture.nullable(),
  trigger: z.string().nullable(),
  steps: z.array(z.strictObject({ name: z.string(), kind: z.string() })),
})

export const WorkflowFileErrorSchema = z.strictObject({ source: z.string(), message: z.string() })

export const WorkflowDefinitionsResponseSchema = z.strictObject({
  items: z.array(WorkflowDefinitionSchema),
  errors: z.array(WorkflowFileErrorSchema),
})

export const WorkflowRunSchema = z.strictObject({
  id: IdSchema,
  taskId: IdSchema,
  name: z.string(),
  status: RunStatus,
  posture: Posture,
  trigger: z.string(),
  error: z.string().nullable(),
  def: z.unknown(), // parsed defJson
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
})

export const WorkflowStepSchema = z.strictObject({
  id: IdSchema,
  runId: IdSchema,
  idx: z.number().int().nonnegative(),
  name: z.string(),
  kind: z.string(),
  mode: z.string(),
  status: StepStatus,
  worktreePath: z.string().nullable(),
  profileId: z.string().nullable(),
  model: z.string().nullable(),
  error: z.string().nullable(),
  structured: z.unknown().nullable(), // parsed structuredJson
  result: z.unknown().nullable(), // parsed resultJson
  costUsd: z.number().nullable(),
  iteration: z.number().int().nonnegative(),
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
})

export const StartRunSchema = z.strictObject({
  definitionId: z.string().min(1).max(200),
  posture: Posture.optional(),
})

export const RunsQuerySchema = PageQuerySchema.extend({ status: RunStatus.optional() })

export const ResolveGateSchema = z.strictObject({ approved: z.boolean() })
