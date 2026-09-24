import { describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import { SCHEDULER, type SchedulerBridge } from '@acorn/node-core/server/schedules/index.ts'
import { buildPluginDeps } from './pluginDeps'

describe('plugin runtime adapters', () => {
  it('resolves the scheduler after plugin initialization', () => {
    const capabilities = new CapabilityRegistry()
    const deps = buildPluginDeps({ capabilities, internalEnv: () => ({}), reconciled: Promise.resolve() })
    const scheduler = { register: vi.fn() } as unknown as SchedulerBridge
    capabilities.provide(SCHEDULER, scheduler)
    expect(deps.workflows.scheduler?.()).toBe(scheduler)
    expect(deps.terminal.reconciled).toBe(deps.agents.reconciled)
  })
})
