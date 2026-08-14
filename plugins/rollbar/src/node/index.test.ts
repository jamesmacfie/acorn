import { fileURLToPath } from 'node:url'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { makeTestNodeContext, validatePluginConfig } from '@acorn/plugin-api/testkit'
import { describe, expect, it, vi } from 'vitest'
import { rollbarPlugin } from './index'

// The context here is the host's, not a hand-drawn copy of it: makeTestNodeContext calls the same
// assembly boot calls (node-core/server/plugin/context.ts), so the tier differences below are decided
// by the host and this file only observes them. The previous version of this test forged
// `{ routes: { register: undefined }, providers: { integration } } as unknown as NodePluginContext`,
// which asserted that the test's own literal said what the test's own literal said.
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

// The permissions the plugin actually ships, read from its own acorn-plugin.config.mjs. So the grant
// this test runs under cannot drift from the grant the owner consents to — and if the config stops
// declaring `projects:read`, init loses ctx.core.projects and this suite says so.
const declaredPermissions = async () => {
  const config = await validatePluginConfig(PACKAGE_ROOT)
  if (!config.ok) throw new Error(config.reason)
  return config.manifest.permissions.node
}

describe('rollbar node plugin', () => {
  it('registers a portable fetch handler on the loaded tier, with no live router seam', async () => {
    const ctx = makeTestNodeContext({ plugin: rollbarPlugin(), permissions: await declaredPermissions() })
    try {
      // Both host decisions: a loaded plugin gets no Hono seam, and gets the core facets its manifest
      // declared. Nothing in this file arranges either.
      expect(ctx.routes.register).toBeUndefined()
      expect(ctx.core.projects.byId).toBeTypeOf('function')

      const integration = vi.spyOn(ctx.providers, 'integration')
      await rollbarPlugin().init(ctx)

      expect(integration).toHaveBeenCalledOnce()
      const route = integration.mock.calls[0]![1] as PluginFetchHandler
      expect(route).toBeTypeOf('function')
    } finally {
      ctx.cleanup()
    }
  })

  it('gets the full context when it runs compiled in', async () => {
    const ctx = makeTestNodeContext({ plugin: rollbarPlugin() })
    try {
      expect(ctx.routes.register).toBeTypeOf('function')
      await rollbarPlugin().init(ctx)
    } finally {
      ctx.cleanup()
    }
  })
})
