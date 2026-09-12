import { z } from 'zod'
import type { FindingScope } from '@acorn/plugin-findings/contract/records.ts'

export const memoryChangePayloadSchema = z.strictObject({
  operation: z.enum(['add', 'update']),
  name: z.string().trim().min(1).max(120).regex(/^[a-z0-9][a-z0-9._-]*$/i),
  type: z.enum(['convention', 'architecture', 'decision', 'fix', 'reference', 'feedback', 'task', 'user']),
  description: z.string().trim().min(1).max(1_000),
  body: z.string().refine((body) => body.trim().length > 0, 'body cannot be blank'),
  scope: z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('project'), projectId: z.string().min(1).optional() }), z.strictObject({ kind: z.literal('private') })]),
  baseMemoryId: z.string().min(1).optional(),
  baseHash: z.string().min(1).optional(),
}).superRefine((value, ctx) => {
  if (value.operation === 'update' && (!value.baseMemoryId || !value.baseHash)) ctx.addIssue({ code: 'custom', message: 'updates require a base memory ID and hash' })
  if (value.operation === 'add' && (value.baseMemoryId || value.baseHash)) ctx.addIssue({ code: 'custom', message: 'adds cannot carry an update base' })
})

export type MemoryChangePayload = z.infer<typeof memoryChangePayloadSchema>
export const resolveMemoryScope = (payload: MemoryChangePayload, candidateScope: FindingScope): MemoryChangePayload => payload.scope.kind === 'project' && !payload.scope.projectId
  ? candidateScope.kind === 'project' ? { ...payload, scope: { kind: 'project', projectId: candidateScope.projectId } } : payload
  : payload
