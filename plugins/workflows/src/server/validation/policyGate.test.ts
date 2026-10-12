import { describe, expect, it } from 'vitest'
import { BUILTIN_STEP_KINDS } from '../steps/builtins'
import { validateWorkflow, type WorkflowValidationCatalog } from './definition'
import type { PolicyDescription, WorkflowDef, WorkflowStepDef } from '../../shared/workflowContracts'

// The rules for a polling `gate-policy` and `ci-loop`'s wait (docs/workflows/execution.md § Polling
// gates). The runner's own behavior is in ../workflowGate.test.ts.

const POLICIES: Record<string, PolicyDescription> = {
  'test:ci': { label: 'CI', description: 'CI.', icon: 'x', fields: [] },
  'test:slow': { label: 'Slow', description: 'Slow.', icon: 'x', fields: [], minIntervalMs: 300_000 },
  'test:command': {
    label: 'Command',
    description: 'Command.',
    icon: 'x',
    fields: [
      { id: 'command', label: 'Command', type: 'text', required: true },
      { id: 'timeoutMs', label: 'Timeout', type: 'number', min: 1_000 },
    ],
  },
}
const describePolicy = (id: string): PolicyDescription | undefined => POLICIES[id]

const catalog: WorkflowValidationCatalog = {
  stepKinds: new Set<string>(BUILTIN_STEP_KINDS),
  policies: new Set(['test:ci', 'test:slow', 'test:command']),
  profiles: new Set(),
  structuredProfiles: new Set(),
  managedProfiles: new Set(),
  describePolicy,
  validatePolicy: (id, settings) => (id === 'test:command' && settings.command === 'rm' ? ['refuses rm'] : []),
}

const check = (steps: WorkflowStepDef[], extra: Partial<WorkflowDef> = {}) =>
  validateWorkflow({ baseline: 'acorn-1', formatVersion: 1, name: 'w', steps, ...extra }, catalog)

const gate = (over: Partial<WorkflowStepDef> = {}): WorkflowStepDef => ({
  id: 'gate',
  name: 'gate',
  kind: 'gate-policy',
  policy: 'test:ci',
  ...over,
})

describe('a polling gate', () => {
  it('accepts a timeout alone, and an interval with a timeout', () => {
    expect(check([gate({ timeoutMs: 3_600_000 })])).toEqual([])
    expect(check([gate({ intervalMs: 120_000, timeoutMs: 3_600_000 })])).toEqual([])
  })

  it('refuses an interval with no timeout, or below the floor for its policy', () => {
    expect(check([gate({ intervalMs: 60_000 })])).toEqual(["step 'gate' polls, so it needs timeoutMs"])
    expect(check([gate({ intervalMs: 10_000, timeoutMs: 60_000 })])).toEqual([
      "step 'gate' intervalMs must be at least 30000 for 'test:ci'",
    ])
    expect(check([gate({ policy: 'test:slow', intervalMs: 60_000, timeoutMs: 3_600_000 })])).toEqual([
      "step 'gate' intervalMs must be at least 300000 for 'test:slow'",
    ])
  })

  it('refuses a timeout longer than the step or run wall-time limit', () => {
    expect(check([gate({ timeoutMs: 120_000, budget: { maxWallTimeMs: 60_000 } })])).toEqual([
      "step 'gate' timeoutMs is longer than its wall-time limit of 60000 ms",
    ])
    expect(check([gate({ timeoutMs: 120_000 })], { budget: { maxWallTimeMs: 90_000 } })).toEqual([
      "step 'gate' timeoutMs is longer than its wall-time limit of 90000 ms",
    ])
  })

  it('takes only pass, fail, and timed-out branches, needs a pass branch, and each must wait on it', () => {
    const next = (id: string): WorkflowStepDef => ({
      id,
      name: id,
      kind: 'gate-policy',
      policy: 'test:ci',
      after: ['gate'],
    })
    expect(
      check([gate({ timeoutMs: 60_000, branches: { pass: 'a', 'timed-out': 'b' } }), next('a'), next('b')]),
    ).toEqual([])
    expect(check([gate({ branches: { maybe: 'a', 'timed-out': 'b' } }), next('a'), next('b')])).toEqual([
      "step 'gate' branch 'maybe' must be pass, fail, or timed-out",
      "step 'gate' has branches, so it needs a pass branch",
    ])
    expect(
      check([
        gate({ branches: { pass: 'a' } }),
        { id: 'a', name: 'a', kind: 'gate-policy', policy: 'test:ci', after: [] },
      ]),
    ).toEqual(["step 'gate' branch 'pass' target 'a' does not wait on step 'gate'"])
  })

  it("checks the policy's settings in with, then the policy's own validator", () => {
    // `timeoutMs` here is the command's own limit, not the gate's, because settings live in `with`.
    expect(check([gate({ policy: 'test:command', with: { command: 'make', timeoutMs: 5 } })])).toEqual([
      "step 'gate' timeout must be between 1000 and -",
    ])
    expect(check([gate({ policy: 'test:command', with: {} })])).toEqual(["step 'gate' needs command"])
    expect(check([gate({ policy: 'test:command', with: { command: 'rm' } })])).toEqual(["step 'gate' refuses rm"])
  })

  it('keeps the polling fields to the kinds that read them', () => {
    expect(check([{ id: 'a', name: 'a', kind: 'gate-human', timeoutMs: 1, checksTimeoutMs: 1 }])).toEqual([
      "step 'a' is a 'gate-human' step, which cannot take timeoutMs",
      "step 'a' is a 'gate-human' step, which cannot take checksTimeoutMs",
    ])
    expect(check([{ id: 'ci', name: 'ci', kind: 'ci-loop', checksTimeoutMs: 0 }])).toContain(
      "step 'ci' checksTimeoutMs must be a positive integer",
    )
  })
})
