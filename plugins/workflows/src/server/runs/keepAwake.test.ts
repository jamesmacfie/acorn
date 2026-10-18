import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { makeTestNodeContext, type TestNodeContext } from '@acorn/plugin-api/testkit'
import type { Extension, ExtensionPointId } from '@acorn/plugin-api/node'
import { WorkflowRunner, type RunnerDeps } from './runner'
import { WORKFLOW_POLICY } from '../../contract/extensions'

// A run holds a keep-awake lease while it moves, and not while it waits at a gate
// (docs/node-distribution/keep-awake.md).

const passing = {
  handlers: <T>(point: ExtensionPointId<T>) =>
    (point === WORKFLOW_POLICY
      ? [
          {
            id: 'test:pass',
            pluginId: 'test',
            order: 0,
            value: {
              describe: { label: 'Pass', description: 'Passes.', icon: 'list', fields: [] },
              evaluate: async () => ({ verdict: 'pass' as const }),
            },
          },
        ]
      : []) as Extension<T>[],
}

describe('workflow keep-awake leases', () => {
  let ctx: TestNodeContext
  let runner: WorkflowRunner
  const leases = { held: 0, holds: 0 }

  beforeEach(() => {
    leases.held = 0
    leases.holds = 0
    ctx = makeTestNodeContext({ plugin: { name: 'workflows' } })
    const deps: RunnerDeps = {
      runStep: async () => {
        throw new Error('No agent step runs in these tests.')
      },
      writeHandoff: async () => {},
      assembleContext: async () => '',
      notify: () => {},
      holdAwake: () => {
        leases.held += 1
        leases.holds += 1
        return () => (leases.held -= 1)
      },
    }
    runner = new WorkflowRunner(ctx.storage.open(), deps, passing)
  })
  afterEach(() => {
    runner.stop()
    ctx.cleanup()
  })

  it('holds while running, lets go at the gate, and holds again until the run ends', async () => {
    const runId = await runner.start('task-1', {
      baseline: 'acorn-1',
      formatVersion: 1,
      name: 'Approval',
      steps: [
        { id: 'approve', name: 'approve', kind: 'gate-human' },
        { id: 'check', name: 'check', kind: 'gate-policy', policy: 'test:pass', after: ['approve'] },
      ],
    })
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('gated'))
    expect(leases).toEqual({ held: 0, holds: 1 })

    const gate = (await runner.steps(runId)).find((step) => step.status === 'waiting-gate')!
    await runner.resolveGate(runId, gate.id, true)
    await vi.waitFor(async () => expect((await runner.run(runId))?.status).toBe('done'))
    expect(leases).toEqual({ held: 0, holds: 2 })
  })
})
