import { z } from 'zod'
import { ApiScopesSchema, IdSchema, PortSchema, UnixMillisSchema } from './primitives'

// Core system + discovery + settings schemas (docs/public-api.md). Shared so client
// tooling and tests infer the same types.

export const HealthSchema = z.strictObject({
  status: z.enum(['ready', 'starting', 'degraded', 'shutting-down']),
  version: z.string(),
  apiVersion: z.literal('v1'),
  startedAt: UnixMillisSchema,
  now: UnixMillisSchema,
  reconciliationComplete: z.boolean(),
})
export type Health = z.infer<typeof HealthSchema>

export const CapabilityPluginSchema = z.strictObject({
  id: z.string(),
  version: z.string().optional(),
  available: z.boolean(),
  unavailableReason: z.string().optional(),
})

export const CapabilitiesSchema = z.strictObject({
  desktop: z.boolean(),
  rendererConnected: z.boolean(),
  terminal: z.boolean(),
  worktrees: z.boolean(),
  plugins: z.array(CapabilityPluginSchema),
})
export type Capabilities = z.infer<typeof CapabilitiesSchema>

export const PrincipalResponseSchema = z.strictObject({
  tokenId: IdSchema,
  name: z.string(),
  prefix: z.string(),
  scopes: ApiScopesSchema,
  user: z.strictObject({ login: z.string(), name: z.string(), avatar: z.string() }),
  expiresAt: UnixMillisSchema.nullable(),
})
export type PrincipalResponse = z.infer<typeof PrincipalResponseSchema>

export const PluginDescriptorSchema = z.strictObject({
  id: z.string(),
  apiPrefix: z.string(),
  operationCount: z.number().int().nonnegative(),
  eventChannels: z.array(z.string()),
})

export const ApiServerSettingsResponseSchema = z.strictObject({
  enabled: z.boolean(),
  port: PortSchema,
  effectivePort: PortSchema,
  bindAddress: z.string(),
  portOverridden: z.boolean(),
  error: z.string().optional(),
})
export type ApiServerSettingsResponse = z.infer<typeof ApiServerSettingsResponseSchema>

export const PatchApiServerSettingsSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    port: PortSchema.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'At least one setting is required')

export const PatchedApiServerSettingsSchema = ApiServerSettingsResponseSchema.extend({
  rebound: z.boolean(),
})
