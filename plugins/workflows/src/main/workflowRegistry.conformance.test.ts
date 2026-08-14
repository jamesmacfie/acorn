import { describe, expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import { WorkflowRunner, type RunnerDeps } from './workflowRunner'

const deps: RunnerDeps = {
  runStep: async () => ({ status: 'ok', exitCode: 0, capture: { result: null, structuredOutput: null, sessionId: null, costUsd: null, events: [] }, stderrTail: '' }),
  writeHandoff: async () => {},
  assembleContext: async () => '',
  evaluatePolicy: async () => ({ pass: true }),
  failingChecks: async () => '',
  notify: () => {},
}

describe('workflow registry conformance', () => {
  it('every registered step kind has a handler and its descriptor validation is projected', () => {
    // This plugin's OWN migrated SQLite file, not core's: the runner cannot see core's tables any more.
    const testDb = makeTestPluginDb('workflows')
    try {
      const runner = new WorkflowRunner(testDb.db, deps)
      for (const [id, descriptor] of runner.contributions.stepKinds.entries()) {
        expect(id).toMatch(/^[a-z][a-z0-9-]*$/)
        expect(typeof descriptor.handler).toBe('function')
      }
      runner.contributions.registerStepKind('custom-required', async () => ({ status: 'done' }), (step, { label }) =>
        step.prompt ? [] : [`${label} requires prompt`],
      )
      expect(runner.validationCatalog().validateStepKind?.('custom-required', { name: 'x', kind: 'custom-required' }, {
        label: "step 'x'", index: 0, indexes: new Map([['x', 0]]), stepAt: () => undefined, policies: new Set(),
      })).toEqual(["step 'x' requires prompt"])
    } finally {
      testDb.cleanup()
    }
  })
})
