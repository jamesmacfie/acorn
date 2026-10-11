import { afterEach, expect, it, vi } from 'vitest'
import { makeTestNodeContext } from '@acorn/plugin-api/testkit'
import type { PluginDatabase } from '@acorn/plugin-api/node'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { persistWorkflowStart, type WorkflowStartOptions } from './start'

const definition: WorkflowDef = {
  baseline: 'acorn-1',
  formatVersion: 1,
  name: 'Review',
  inputs: [{ name: 'reason', schema: { type: 'string' }, required: true }],
  steps: [{ id: 'approve', name: 'Approve', kind: 'gate-human' }],
}
vi.mock('../definitions/resolution', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  resolveScopedWorkflowDefinition: async () => ({ definition, provenance: { source: 'database' } }),
  resolveWorkflowGraph: async (_db: unknown, _def: unknown, options: { inputs: { reason: string } }) => ({
    root: { ...definition, inputs: definition.inputs?.map((input) => ({ ...input, default: options.inputs.reason })) },
    nodes: [],
    fingerprint: 'graph',
    requiresRepoTrust: false,
  }),
}))

import { WorkflowStartService } from './admission'

let cleanup = () => {}
afterEach(() => {
  cleanup()
  cleanup = () => {}
})

function setup() {
  const ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
  cleanup = ctx.cleanup
  const db = ctx.storage.open() as PluginDatabase
  const created: string[] = []
  const runner = {
    validationCatalog: () => ({}),
    start: async (taskId: string, def: WorkflowDef, options: WorkflowStartOptions) => {
      const result = await persistWorkflowStart(db, taskId, def, options)
      if (result.created) created.push(result.runId)
      return result.runId
    },
  }
  const service = new WorkflowStartService(
    db,
    runner as never,
    {
      reconciled: Promise.resolve(),
      taskScope: async () => ({ projectId: 'project' }) as never,
      project: async () => null,
      authorizeRepoConfig: async () => {},
      onTrustRequired: () => {},
    },
    '/tmp',
  )
  return { service, created }
}

it('returns the persisted run after a lost device response and rejects conflicting replay', async () => {
  const { service, created } = setup()
  const launchId = '4a67745d-e627-478c-93f5-4f0800d37f11'
  const first = await service.startById('task-1', 'review', { reason: 'Because' }, true, launchId)
  expect(first).toMatchObject({ runId: launchId })
  const replay = await service.startById('task-1', 'review', { reason: 'Because' }, true, launchId)
  expect(replay).toEqual(first)
  expect(created).toHaveLength(1)
  expect((await service.startById('task-1', 'review', { reason: 'Changed' }, true, launchId)).error).toContain(
    'different',
  )
  expect((await service.startById('task-2', 'review', { reason: 'Because' }, true, launchId)).error).toContain(
    'different',
  )
  expect(created).toHaveLength(1)
})

it('admits one run when trust completion and Retry send the same launch concurrently', async () => {
  const { service, created } = setup()
  const launchId = 'e16b8cf3-ced6-4c6b-b1d8-08122a22a267'
  const [trusted, retried] = await Promise.all([
    service.startById('task-1', 'review', { reason: 'Because' }, true, launchId),
    service.startById('task-1', 'review', { reason: 'Because' }, true, launchId),
  ])
  expect(trusted.runId).toBe(launchId)
  expect(retried).toEqual(trusted)
  expect(created).toEqual([launchId])
})
