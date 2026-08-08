import { z } from 'zod'

export const toolRiskSchema = z.enum(['read', 'write', 'execute'])
export const toolPermissionsSchema = z.strictObject({
  tiers: z.partialRecord(toolRiskSchema, z.boolean()).optional(),
  tools: z.record(z.string().min(1), z.boolean()).optional(),
})
export type ToolPermissions = z.infer<typeof toolPermissionsSchema>
