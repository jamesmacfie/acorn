import { describe, expect, it } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import type { Extension, ExtensionPointId } from '@acorn/plugin-api/node'
import { WORKFLOW_STEP_KIND, type StepKindContribution } from '../contract/extensions'
import { BUILTIN_STEP_KINDS } from './workflowBuiltins'
import { WorkflowRunner, type RunnerDeps, type WorkflowExtensions } from './workflowRunner'

const deps: RunnerDeps = {
  runStep: async () => ({ status: 'ok', exitCode: 0, capture: { result: null, structuredOutput: null, sessionId: null, costUsd: null, events: [] }, stderrTail: '' }),
  writeHandoff: async () => {},
  assembleContext: async () => '',
  evaluatePolicy: async () => ({ pass: true }),
  failingChecks: async () => '',
  notify: () => {},
}

// A stand-in for `ctx.extensionPoints`, holding one contributed step kind the way the http plugin's
// would arrive: entry id already qualified by the host.
const extensions = (entries: Extension<unknown>[]): WorkflowExtensions => ({
  entries: <T>(point: ExtensionPointId<T>) => (point === WORKFLOW_STEP_KIND ? (entries as Extension<T>[]) : []),
})

describe('workflow extension points', () => {
  it('offers the built-in kinds as bare words and a contributed kind under its plugin id', () => {
    // This plugin's own migrated SQLite file, not core's: the runner cannot see core's tables.
    const testDb = makeTestPluginDb('workflows')
    try {
      const runner = new WorkflowRunner(testDb.db, deps, extensions([{
        id: 'other:custom-required',
        pluginId: 'other',
        order: 0,
        value: {
          handler: async () => ({ status: 'done' as const }),
          validate: (step, { label }) => (step.prompt ? [] : [`${label} requires prompt`]),
        } satisfies StepKindContribution,
      }]))
      const catalog = runner.validationCatalog()
      for (const kind of BUILTIN_STEP_KINDS) expect(catalog.stepKinds.has(kind)).toBe(true)
      // Qualified, so a workflow file naming it says which package runs the step, and two plugins can
      // both call their entry `custom-required`.
      expect(catalog.stepKinds.has('other:custom-required')).toBe(true)
      expect(catalog.validateStepKind?.('other:custom-required', { name: 'x', kind: 'other:custom-required' }, {
        label: "step 'x'", index: 0, indexes: new Map([['x', 0]]), stepAt: () => undefined, policies: new Set(), after: () => [], precedes: () => false,
      })).toEqual(["step 'x' requires prompt"])
    } finally {
      testDb.cleanup()
    }
  })
})
