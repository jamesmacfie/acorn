import { describe, expect, it, vi } from 'vitest'
import { makeTestPluginDb } from '@acorn/plugin-api/testkit'
import type { Extension, ExtensionPointId } from '@acorn/plugin-api/node'
import type { TerminalWorkflowStepKind } from '@acorn/plugin-terminal/contract/workflowSteps.ts'
import { WORKFLOW_STEP_KIND, type StepKindContribution } from '../contract/extensions'
import { BUILTIN_STEP_KINDS } from './workflowBuiltins'
import { validateWorkflow } from './workflowValidation'
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

const described = (over: Partial<StepKindContribution> = {}): StepKindContribution => ({
  handler: async () => ({ status: 'done' as const }),
  describe: {
    label: 'Ring a bell',
    fields: [
      { id: 'bell', label: 'Bell', type: 'text', required: true },
      { id: 'volume', label: 'Volume', type: 'number', min: 1, max: 10 },
    ],
  },
  ...over,
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

describe('the kind catalog', () => {
  const withKinds = (entries: Extension<unknown>[], body: (runner: WorkflowRunner) => void) => {
    const testDb = makeTestPluginDb('workflows')
    try {
      body(new WorkflowRunner(testDb.db, deps, extensions(entries)))
    } finally {
      testDb.cleanup()
    }
  }

  it('carries a contributed kind\'s description, and null for one that has none', () => {
    withKinds([
      { id: 'other:bell', pluginId: 'other', order: 0, value: described() },
      { id: 'other:quiet', pluginId: 'other', order: 0, value: { handler: async () => ({ status: 'done' as const }) } },
    ], (runner) => {
      const catalog = runner.catalog()
      // Every built-in describes itself too, so the editor draws a built-in and a contribution the
      // same way (../shared/stepFields.ts).
      expect(catalog.kinds.find((kind) => kind.id === 'agent')).toMatchObject({ pluginId: null })
      expect(catalog.kinds.find((kind) => kind.id === 'agent')?.describe?.fields.map((field) => field.id)).toContain('prompt')
      expect(catalog.kinds.find((kind) => kind.id === 'other:bell')?.describe?.fields.map((field) => field.id)).toEqual(['bell', 'volume'])
      expect(catalog.kinds.find((kind) => kind.id === 'other:quiet')?.describe).toBeNull()
      expect(catalog.policies).toContainEqual({ id: 'checks-green', pluginId: null })
    })
  })

  it('applies required, min and max before the kind\'s own validator', () => {
    const validate = vi.fn(() => ['the kind said no'])
    withKinds([{ id: 'other:bell', pluginId: 'other', order: 0, value: described({ validate }) }], (runner) => {
      const problems = validateWorkflow(
        { name: 'w', steps: [{ name: 'ring', kind: 'other:bell', with: { volume: 99 } }] },
        runner.validationCatalog(),
      )
      expect(problems).toEqual(["step 'ring' needs bell", "step 'ring' volume must be between 1 and 10"])
      // The validator was never called: the contract is that it may assume the shape is right.
      expect(validate).not.toHaveBeenCalled()
    })
  })

  it('lets a contributed kind take isolation only when its description says it runs an agent', () => {
    withKinds([
      { id: 'other:think', pluginId: 'other', order: 0, value: described({ describe: { label: 'Think', runsAgent: true, fields: [] } }) },
      { id: 'other:bell', pluginId: 'other', order: 0, value: described({ describe: { label: 'Ring', fields: [] } }) },
    ], (runner) => {
      const catalog = runner.validationCatalog()
      // Only the isolation rule is under test: no agent profile is registered in this process, so the
      // profile check has something to say about both steps.
      expect(validateWorkflow({ name: 'w', steps: [{ name: 'a', kind: 'other:think', isolation: 'worktree' }] }, catalog))
        .not.toContain("step 'a' is a 'other:think' step, which cannot take isolation")
      expect(validateWorkflow({ name: 'w', steps: [{ name: 'a', kind: 'other:bell', isolation: 'worktree' }] }, catalog))
        .toEqual(["step 'a' is a 'other:bell' step, which cannot take isolation"])
    })
  })
})

// plugins/terminal contributes two kinds against a local mirror of the contribution type, because it
// cannot depend on this package (../../../terminal/src/contract/workflowSteps.ts says why). This is
// where the mirror is held against the real thing: a drift is a compile error, not a kind that quietly
// stops loading.
describe('the terminal mirror of the contribution type', () => {
  it('still satisfies the type the runner dispatches through', () => {
    const mirrored = null as unknown as TerminalWorkflowStepKind
    const real: StepKindContribution = mirrored
    expect(real).toBeNull()
  })
})
