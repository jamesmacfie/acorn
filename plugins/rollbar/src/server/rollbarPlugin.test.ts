import { fileURLToPath } from 'node:url'
import type { PluginFetchHandler } from '@acorn/plugin-api/node'
import { makeTestNodeContext, validatePluginConfig } from '@acorn/plugin-api/testkit'
import { describe, expect, it, vi } from 'vitest'
import { rollbarPlugin } from './index'

// Context comes from makeTestNodeContext, the same boot path the host uses (docs/plugins.md § The
// plugin API), so the tier differences below are the host's decisions, not this test's.
const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

// Reads the permissions the plugin actually declares in its own acorn-plugin.config.mjs, so the
// grant this test runs under tracks the manifest. If it drops `projects:read`, init loses
// ctx.core.projects and this suite catches it.
const declaredPermissions = async () => {
  const config = await validatePluginConfig(PACKAGE_ROOT)
  if (!config.ok) throw new Error(config.reason)
  return config.manifest.permissions.node
}

describe('rollbar node plugin', () => {
  it('registers a portable fetch handler on the loaded tier, with no live router seam', async () => {
    const ctx = makeTestNodeContext({ plugin: rollbarPlugin(), permissions: await declaredPermissions() })
    try {
      // Both are host decisions: a loaded plugin gets no Hono seam, and only the core facets its
      // manifest declared. Nothing in this file arranges either.
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
