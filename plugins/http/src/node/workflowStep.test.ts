import { describe, expect, it } from 'vitest'
import type { StepValidationContext } from '@acorn/plugin-workflows/contract/extensions.ts'
import { validateHttpStep } from './workflowStep'

// The `http:request` step's authoring check. Worth its own test because it is the reason the step is
// validated at load rather than at run: a bad step should be a red row in the workflow list, not a run
// that starts and fails on its third step, half an hour and one agent session in.

const context: StepValidationContext = {
  label: "step 'call'",
  index: 0,
  indexes: new Map([['call', 0]]),
  stepAt: () => undefined,
  policies: new Set(),
}

const step = (withTable: unknown) => ({ name: 'call', kind: 'http:request', with: withTable as Record<string, unknown> })

describe('the http:request step', () => {
  it('accepts a method in any case, and a url', () => {
    expect(validateHttpStep(step({ method: 'post', url: 'https://example.test/hook' }), context)).toEqual([])
  })

  it('accepts a url that is entirely a variable', () => {
    // The normal case, and why the scheme check that matters runs after interpolation rather than
    // here: at authoring time there is nothing to check a scheme against.
    expect(validateHttpStep(step({ method: 'GET', url: '{{deploy_hook}}' }), context)).toEqual([])
  })

  it('names what is missing rather than saying the step is invalid', () => {
    expect(validateHttpStep(step(undefined), context)).toEqual(["step 'call' needs a [steps.with] table with a method and a url"])
    expect(validateHttpStep(step({ method: 'GET' }), context)).toEqual(["step 'call' has no url"])
    expect(validateHttpStep(step({ url: 'https://example.test' }), context))
      .toEqual(["step 'call' needs one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS as its method"])
    expect(validateHttpStep(step({ method: 'TRACE', url: 'https://example.test' }), context))
      .toEqual(["step 'call' needs one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS as its method"])
  })

  it('refuses headers that are not a table', () => {
    expect(validateHttpStep(step({ method: 'GET', url: 'https://x.test', headers: ['a: b'] }), context))
      .toEqual(["step 'call' headers must be a table of strings"])
  })
})
