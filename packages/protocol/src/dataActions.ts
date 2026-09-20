import { z } from 'zod'

const risk = z.enum(['read', 'write', 'execute'])
const withRisk = <T extends z.ZodRawShape>(shape: T) => z.object({ ...shape, risk: risk.optional() })

/** A bounded host-rendered action attached to a source record. */
export const dataRecordActionSchema = z.discriminatedUnion('verb', [
  withRisk({ verb: z.literal('openPane'), pane: z.string().min(1).max(64) }),
  withRisk({ verb: z.literal('openTask') }),
  withRisk({ verb: z.literal('runNodeAction'), path: z.string().min(1).max(256) }),
  withRisk({ verb: z.literal('openUrl'), url: z.string().url() }),
  withRisk({ verb: z.literal('openOverlay'), overlay: z.string().min(1).max(64) }),
  withRisk({ verb: z.literal('surfaceAction'), surface: z.string().min(1).max(64) }),
])

export type DataRecordAction = z.infer<typeof dataRecordActionSchema>
export type DataRecordActionRisk = z.infer<typeof risk>
