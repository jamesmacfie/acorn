import { z } from 'zod'
import {
  ApiServerSettingsResponseSchema,
  CapabilitiesSchema,
  HealthSchema,
  PatchApiServerSettingsSchema,
  PatchedApiServerSettingsSchema,
  PluginDescriptorSchema,
  PrincipalResponseSchema,
} from '../../shared/publicApi/core'
import { defineEndpoint, type PluginApiContribution } from './defineEndpoint'
import type { RegistrySnapshot } from './registry'

// Core system + discovery + settings endpoints (docs/next/api/core-api.md §2, §3). Registered under
// pluginId 'core' before the registry freezes. Runtime-dependent values (readiness, renderer
// connection, listener rebind) come from injected providers so this module stays main-agnostic.

export type RuntimeInfo = {
  version: string
  startedAt: number
  desktop: boolean
  reconciliationComplete: () => boolean
  rendererConnected: () => boolean
  terminalAvailable: () => boolean
  worktreesAvailable: () => boolean
  // Plugin availability catalog for /capabilities (id + reason).
  pluginCapabilities: () => { id: string; version?: string; available: boolean; unavailableReason?: string }[]
  shuttingDown: () => boolean
}

export type ApiSettingsController = {
  read(): z.infer<typeof ApiServerSettingsResponseSchema>
  // Apply a settings change, performing a transactional listener rebind on a port change. Throws a
  // PublicApiError (setting_overridden / port_in_use) when the change cannot be applied.
  patch(patch: z.infer<typeof PatchApiServerSettingsSchema>): Promise<z.infer<typeof PatchedApiServerSettingsSchema>>
}

export type CoreSystemDeps = {
  runtime: RuntimeInfo
  settings: ApiSettingsController
  getSnapshot: () => RegistrySnapshot
}

export function buildCoreSystemContribution(deps: CoreSystemDeps): PluginApiContribution {
  const { runtime, settings, getSnapshot } = deps
  return {
    pluginId: 'core',
    endpoints: [
      defineEndpoint({
        operationId: 'core.system.health',
        pluginId: 'core',
        method: 'GET',
        path: '/health',
        scope: 'read',
        risk: 'read',
        summary: 'Process/version/readiness summary',
        response: HealthSchema,
        handler: async () => ({
          status: runtime.shuttingDown() ? ('shutting-down' as const) : runtime.reconciliationComplete() ? ('ready' as const) : ('starting' as const),
          version: runtime.version,
          apiVersion: 'v1' as const,
          startedAt: runtime.startedAt,
          now: Date.now(),
          reconciliationComplete: runtime.reconciliationComplete(),
        }),
      }),
      defineEndpoint({
        operationId: 'core.system.capabilities',
        pluginId: 'core',
        method: 'GET',
        path: '/capabilities',
        scope: 'read',
        risk: 'read',
        summary: 'Active core/plugin/capability catalog',
        response: CapabilitiesSchema,
        handler: async () => ({
          desktop: runtime.desktop,
          rendererConnected: runtime.rendererConnected(),
          terminal: runtime.terminalAvailable(),
          worktrees: runtime.worktreesAvailable(),
          plugins: runtime.pluginCapabilities(),
        }),
      }),
      defineEndpoint({
        operationId: 'core.system.principal',
        pluginId: 'core',
        method: 'GET',
        path: '/principal',
        scope: 'read',
        risk: 'read',
        summary: 'Current token metadata; never the secret',
        response: PrincipalResponseSchema,
        handler: async (ctx) => ({
          tokenId: ctx.principal.tokenId,
          name: ctx.principal.name,
          prefix: ctx.principal.prefix,
          scopes: ctx.principal.scopes,
          user: ctx.principal.user,
          expiresAt: ctx.principal.expiresAt,
        }),
      }),
      defineEndpoint({
        operationId: 'core.system.plugins',
        pluginId: 'core',
        method: 'GET',
        path: '/plugins',
        scope: 'read',
        risk: 'read',
        summary: 'Installed plugin descriptors and their API prefixes',
        response: z.strictObject({ items: z.array(PluginDescriptorSchema) }),
        handler: async () => {
          const snap = getSnapshot()
          const ids = new Set<string>()
          for (const e of snap.endpoints) if (e.pluginId !== 'core') ids.add(e.pluginId)
          const items = [...ids].sort().map((id) => ({
            id,
            apiPrefix: `/api/v1/plugins/${id}`,
            operationCount: snap.endpoints.filter((e) => e.pluginId === id).length,
            eventChannels: snap.events.filter((e) => e.pluginId === id).map((e) => e.channel),
          }))
          return { items }
        },
      }),
      defineEndpoint({
        operationId: 'core.settings.api.get',
        pluginId: 'core',
        method: 'GET',
        path: '/settings/api',
        scope: 'read',
        risk: 'read',
        summary: 'API listener settings plus effective bind address',
        response: ApiServerSettingsResponseSchema,
        handler: async () => settings.read(),
      }),
      defineEndpoint({
        operationId: 'core.settings.api.patch',
        pluginId: 'core',
        method: 'PATCH',
        path: '/settings/api',
        scope: 'write',
        risk: 'write',
        summary: 'Change listener enabled/port; transactional rebind',
        body: PatchApiServerSettingsSchema,
        response: PatchedApiServerSettingsSchema,
        handler: async (_ctx, { body }) => settings.patch(body),
      }),
    ],
  }
}
