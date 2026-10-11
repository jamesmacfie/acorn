import { z } from 'zod'
import { parseBackendId } from '@acorn/protocol/modelProviders.ts'

export const SUMMARY_CONTEXT_MAX_CHARS = 10_000
export const SUMMARY_TIMEOUT_MS = 180_000

export const sessionSummarySchema = z.object({
  backendId: z
    .string()
    .min(1)
    .max(200)
    .refine((id) => {
      try {
        parseBackendId(id)
        return true
      } catch {
        return false
      }
    }),
  modelId: z.string().trim().min(1).max(200).optional(),
  context: z.string().max(SUMMARY_CONTEXT_MAX_CHARS).default(''),
})

export type SessionSummaryInput = z.infer<typeof sessionSummarySchema>
export type SessionSummary = { markdown: string; truncated: boolean; throughSeq: number }
