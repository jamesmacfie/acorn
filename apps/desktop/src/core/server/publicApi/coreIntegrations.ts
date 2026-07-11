import { z } from 'zod'
import type { AppDatabase } from '../db'
import {
  connectProvider,
  connectionSummary,
  disconnectConnection,
  githubConnectionSummary,
  listConnections,
  rotateConnection,
  setConnectionDisabled,
  testConnection,
} from '../integrations/connections'
import { integrationProviderRegistry } from '../integrations/registry'
import { ProviderOperationError } from '../integrations/types'
import { PublicApiError, type ErrorCode } from '../../shared/publicApi/errors'
import { IdSchema } from '../../shared/publicApi/primitives'
import {
  ConnectIntegrationSchema,
  IntegrationSummarySchema,
  IntegrationsResponseSchema,
  PatchIntegrationSchema,
  RotateCredentialsSchema,
} from '../../shared/publicApi/integrations'
import { NO_CONTENT, defineEndpoint, type PluginApiContribution } from './defineEndpoint'
import type { Integration } from '../../shared/api'

// Core integration connection lifecycle (docs/public-api.md). Connections are core
// resources because core encrypts credentials; provider plugins only validate and use them.
// Reuses the existing connections service so the public and internal surfaces can't drift.

const CORE = 'core'
const ConnParams = z.strictObject({ connectionId: IdSchema })

type IntegrationSummary = z.infer<typeof IntegrationSummarySchema>

// Map a provider error to the public vocabulary (status → code); the code carries as the message.
function mapProviderError(e: unknown): PublicApiError {
  if (e instanceof ProviderOperationError) {
    const byStatus: Record<number, ErrorCode> = { 400: 'provider_validation_failed', 403: 'operation_forbidden', 404: 'not_found', 409: 'conflict', 422: 'provider_validation_failed' }
    return new PublicApiError(byStatus[e.status] ?? 'provider_unavailable', e.code)
  }
  return new PublicApiError('provider_unavailable', 'Provider operation failed')
}

// Project the internal Integration onto the public summary (credentials never appear here).
function toSummary(i: Integration): IntegrationSummary {
  return {
    id: i.id,
    providerId: i.providerId,
    label: i.label,
    status: i.status,
    authKind: i.authKind,
    account: i.account ? { id: i.account.id, label: i.account.label, ...(i.account.type ? { type: i.account.type } : {}) } : null,
    scopes: i.scopes,
    capabilities: i.capabilities,
    createdAt: i.createdAt,
    updatedAt: i.updatedAt,
    ...(i.lastValidatedAt !== undefined ? { lastValidatedAt: i.lastValidatedAt } : {}),
    ...(i.lastError !== undefined ? { lastError: i.lastError } : {}),
  }
}

export function buildCoreIntegrationsContribution(db: AppDatabase, encKey: string): PluginApiContribution {
  return {
    pluginId: CORE,
    endpoints: [
      defineEndpoint({
        operationId: 'core.integration.list',
        pluginId: CORE,
        method: 'GET',
        path: '/integrations',
        scope: 'read',
        risk: 'read',
        summary: 'Provider catalog + safe connection summaries',
        response: IntegrationsResponseSchema,
        handler: async (ctx) => {
          const rows = await listConnections(db, ctx.actor.principalId)
          return {
            providers: integrationProviderRegistry.list().map((p) => p.toPublic() as Record<string, unknown>),
            integrations: [toSummary(githubConnectionSummary(ctx.actor.principalId)), ...rows.map((r) => toSummary(connectionSummary(r)))],
          }
        },
      }),
      defineEndpoint({
        operationId: 'core.integration.connect',
        pluginId: CORE,
        method: 'POST',
        path: '/integrations',
        scope: 'write',
        risk: 'write',
        summary: 'Connect a provider',
        idempotency: 'required',
        body: ConnectIntegrationSchema,
        response: IntegrationSummarySchema,
        status: 201,
        handler: async (ctx, { body }) => {
          try {
            return toSummary(await connectProvider(db, ctx.actor.principalId, { providerId: body.providerId, credentials: body.credentials }, encKey))
          } catch (e) {
            throw mapProviderError(e)
          }
        },
      }),
      defineEndpoint({
        operationId: 'core.integration.credentials',
        pluginId: CORE,
        method: 'PUT',
        path: '/integrations/:connectionId/credentials',
        scope: 'write',
        risk: 'write',
        summary: 'Replace a connection’s credentials',
        params: ConnParams,
        body: RotateCredentialsSchema,
        response: IntegrationSummarySchema,
        handler: async (ctx, { params: p, body }) => {
          try {
            return toSummary(await rotateConnection(db, ctx.actor.principalId, p.connectionId, { credentials: body.credentials }, encKey))
          } catch (e) {
            throw mapProviderError(e)
          }
        },
      }),
      defineEndpoint({
        operationId: 'core.integration.test',
        pluginId: CORE,
        method: 'POST',
        path: '/integrations/:connectionId/test',
        scope: 'write',
        risk: 'write',
        summary: 'Re-validate a connection',
        params: ConnParams,
        body: z.undefined(),
        response: IntegrationSummarySchema,
        handler: async (ctx, { params: p }) => {
          try {
            return toSummary(await testConnection(db, ctx.actor.principalId, p.connectionId, encKey))
          } catch (e) {
            throw mapProviderError(e)
          }
        },
      }),
      defineEndpoint({
        operationId: 'core.integration.patch',
        pluginId: CORE,
        method: 'PATCH',
        path: '/integrations/:connectionId',
        scope: 'write',
        risk: 'write',
        summary: 'Enable or disable a connection',
        params: ConnParams,
        body: PatchIntegrationSchema,
        response: IntegrationSummarySchema,
        handler: async (ctx, { params: p, body }) => {
          try {
            return toSummary(await setConnectionDisabled(db, ctx.actor.principalId, p.connectionId, body.disabled))
          } catch (e) {
            throw mapProviderError(e)
          }
        },
      }),
      defineEndpoint({
        operationId: 'core.integration.delete',
        pluginId: CORE,
        method: 'DELETE',
        path: '/integrations/:connectionId',
        scope: 'write',
        risk: 'write',
        summary: 'Disconnect a connection',
        params: ConnParams,
        response: z.undefined(),
        status: 204,
        handler: async (ctx, { params: p }) => {
          await disconnectConnection(db, ctx.actor.principalId, p.connectionId)
          return NO_CONTENT
        },
      }),
    ],
  }
}
