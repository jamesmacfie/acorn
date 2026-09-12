import { describe, expect, it, vi } from 'vitest'
import { CapabilityRegistry } from '@acorn/node-core/server/pluginHost/capabilities.ts'
import type { CoreServices } from '@acorn/node-core/server/core/index.ts'
import { AGENTS_REVIEW_INPUT } from '@acorn/plugin-agents/contract/lifecycle.ts'
import { FINDINGS_LIFECYCLE } from '@acorn/plugin-findings/contract/lifecycle.ts'
import { MEMORY_KNOWLEDGE } from '@acorn/plugin-memory/contract/knowledge.ts'
import { buildPluginDeps } from './pluginDeps'

const event = { taskId: 'task', sessionId: 'session', turnId: 'turn', source: 'interactive' as const, status: 'completed' as const, attempt: 1 }

describe('findings lifecycle composition', () => {
  it('uses legacy generation only while findings is absent or cutover is unsafe', async () => {
    const capabilities = new CapabilityRegistry()
    const memoryReviewTrigger = vi.fn(async () => undefined)
    capabilities.provide(MEMORY_KNOWLEDGE, { launchInjector: async () => undefined, memoryReviewTrigger })
    capabilities.provide(AGENTS_REVIEW_INPUT, {
      listCompleted: async () => [],
      read: async () => ({ ...event, purpose: 'ordinary', completedSequence: 3, completedAt: 4, availability: 'available', assistantSummary: 'Summary', userMessages: [], unavailableReason: null }),
    })
    const deps = buildPluginDeps({ capabilities, core: {} as CoreServices, internalEnv: () => ({}), reconciled: Promise.resolve() })
    await deps.agents.onCompletedTurn!(event)
    expect(memoryReviewTrigger).toHaveBeenCalledWith('task', 'Summary')

    capabilities.provide(FINDINGS_LIFECYCLE, {
      boundary: vi.fn(), reconcile: async () => undefined,
      settings: async () => ({ automaticPreparation: false, notifyWhenReady: false, backendId: null, modelId: null }),
      setSettings: async (_id, settings) => settings,
      migrationReport: async () => ({ version: 1, cutoverReady: true, files: 0, imported: { pending: 0, accepted: 0, rejected: 0 }, errors: 0, changed: 0, mappings: [] }),
      legacyMapping: async () => null, dismissLegacy: async () => false, export: async () => ({}),
    })
    await deps.agents.onCompletedTurn!(event)
    expect(memoryReviewTrigger).toHaveBeenCalledTimes(1)
  })

  it('routes terminal and workflow terminals to stable findings boundaries', async () => {
    const capabilities = new CapabilityRegistry()
    capabilities.provide(MEMORY_KNOWLEDGE, { launchInjector: async () => undefined, memoryReviewTrigger: vi.fn() })
    const boundary = vi.fn(async (input) => ({ ...input, observationId: 'observation', preparedBundleId: null, updatedAt: 1 }))
    capabilities.provide(FINDINGS_LIFECYCLE, {
      boundary, reconcile: async () => undefined,
      settings: async () => ({ automaticPreparation: false, notifyWhenReady: false, backendId: null, modelId: null }),
      setSettings: async (_id, settings) => settings,
      migrationReport: async () => ({ version: 1, cutoverReady: true, files: 0, imported: { pending: 0, accepted: 0, rejected: 0 }, errors: 0, changed: 0, mappings: [] }),
      legacyMapping: async () => null, dismissLegacy: async () => false, export: async () => ({}),
    })
    const deps = buildPluginDeps({ capabilities, core: {} as CoreServices, internalEnv: () => ({}), reconciled: Promise.resolve() })
    await deps.terminal.reviewBoundary!({ taskId: 'task', sessionId: 'session', exitCode: 0, transcriptTail: 'done' })
    await deps.workflows.reviewBoundary!({ taskId: 'task', runId: 'run', status: 'failed', transcriptTail: null })
    expect(boundary.mock.calls.map(([input]) => input)).toMatchObject([
      { boundaryKey: 'terminal:session:exit', availability: 'available' },
      { boundaryKey: 'workflow:run:terminal', availability: 'unavailable', title: 'Workflow failed' },
    ])
  })
})
