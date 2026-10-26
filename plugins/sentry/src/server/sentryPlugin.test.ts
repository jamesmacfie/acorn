import { fileURLToPath } from 'node:url'
import { makeTestNodeContext, validatePluginConfig } from '@acorn/plugin-api/testkit'
import { describe, expect, it, vi } from 'vitest'
import { sentryPlugin } from '../node/index'

const PACKAGE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

describe('sentry node plugin', () => {
  it('registers its integration and its routes under the permissions it declares', async () => {
    const config = await validatePluginConfig(PACKAGE_ROOT)
    if (!config.ok) throw new Error(config.reason)
    expect(config.manifest.permissions.node.env).toEqual([
      'ACORN_SENTRY_TOKEN',
      'ACORN_SENTRY_ORG',
      'ACORN_SENTRY_PROJECT',
      'ACORN_SENTRY_URL',
    ])
    const ctx = makeTestNodeContext({ plugin: sentryPlugin(), permissions: config.manifest.permissions.node })
    try {
      const integration = vi.spyOn(ctx.providers, 'integration')
      await sentryPlugin().init(ctx)
      expect(integration).toHaveBeenCalledOnce()
      expect(integration.mock.calls[0]![0]).toMatchObject({ id: 'sentry', kind: 'error-tracker' })
      expect(integration.mock.calls[0]![1]).toBeTypeOf('function')
    } finally {
      ctx.cleanup()
    }
  })
})
