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
  withRisk({ verb: z.literal('navigate'), surface: z.string().min(1).max(64) }),
  withRisk({ verb: z.literal('createTask') }),
])

export const dataRecordTargetSchema = z.object({
  kind: z.string().regex(/^[a-z0-9-]+\.[a-z0-9-]+$/).max(129),
  item: z.string().min(1).max(200),
}).strict()

export const namedDataRecordActionSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(80),
  icon: z.string().min(1).max(64).optional(),
  risk,
  action: dataRecordActionSchema,
}).strict()

export type DataRecordAction = z.infer<typeof dataRecordActionSchema>
export type DataRecordActionRisk = z.infer<typeof risk>
export type NamedDataRecordAction = z.infer<typeof namedDataRecordActionSchema>
