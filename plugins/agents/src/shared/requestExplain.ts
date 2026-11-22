import type { z } from 'zod'
import type { modelChoiceSchema } from './sessionSummary'

// An agent CLI backend spends most of this starting up, so it gets more than a short answer needs.
export const EXPLAIN_TIMEOUT_MS = 90_000

export type RequestExplainInput = z.infer<typeof modelChoiceSchema>
export type RequestExplanation = { text: string }
