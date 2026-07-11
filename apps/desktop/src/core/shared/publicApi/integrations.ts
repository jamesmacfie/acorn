import { z } from 'zod'
import { UnixMillisSchema } from './primitives'

// Integration connection lifecycle public schemas (docs/public-api.md). Credentials are
// write-only and never appear in responses. status/authKind/lastError are server-controlled opaque
// strings (kept as strings so a new provider value can't 500 a response-contract check).

export const IntegrationSummarySchema = z.strictObject({
  id: z.string(),
  providerId: z.string(),
  label: z.string(),
  status: z.string(),
  authKind: z.string(),
  account: z.strictObject({ id: z.string(), label: z.string(), type: z.string().optional() }).nullable(),
  scopes: z.array(z.string()),
  capabilities: z.record(z.string(), z.enum(['available', 'missing-scope', 'degraded'])),
  createdAt: UnixMillisSchema,
  updatedAt: UnixMillisSchema,
  lastValidatedAt: UnixMillisSchema.optional(),
  lastError: z.string().optional(),
})

export const IntegrationsResponseSchema = z.strictObject({
  providers: z.array(z.record(z.string(), z.unknown())),
  integrations: z.array(IntegrationSummarySchema),
})

export const ConnectIntegrationSchema = z.strictObject({
  providerId: z.string().min(1).max(100),
  credentials: z.record(z.string().min(1).max(100), z.string().max(100_000)),
})

export const RotateCredentialsSchema = z.strictObject({
  credentials: z.record(z.string().min(1).max(100), z.string().max(100_000)),
})

export const PatchIntegrationSchema = z.strictObject({ disabled: z.boolean() })
