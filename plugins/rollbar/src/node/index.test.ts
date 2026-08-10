import type { NodePluginContext, PluginFetchHandler } from '@acorn/plugin-api/node'
import { describe, expect, it, vi } from 'vitest'
import { rollbarPlugin } from './index'

describe('rollbar node plugin', () => {
  it('registers a portable fetch handler when loaded from disk', () => {
    const integration = vi.fn()
    const projects = {
      byId: vi.fn(),
      externalProjects: vi.fn(),
    }
    const context = {
      // Loaded-plugin contexts deliberately omit the live Hono registration seam.
      routes: { register: undefined },
      providers: { integration },
      core: { projects },
    } as unknown as NodePluginContext

    rollbarPlugin().init(context)

    expect(integration).toHaveBeenCalledOnce()
    const route = integration.mock.calls[0]![1] as PluginFetchHandler
    expect(route).toBeTypeOf('function')
  })
})
