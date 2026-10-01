import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, expect, it } from 'vitest'
import type { WorkflowBudget } from '../../shared/workflowContracts'
import TimeBudgetField from './TimeBudgetField'

let dispose: (() => void) | undefined
afterEach(() => { dispose?.(); document.body.replaceChildren() })

it('edits minutes, preserves other limits, and restores inheritance when cleared', () => {
  const [budget, setBudget] = createSignal<WorkflowBudget | undefined>({ maxWallTimeMs: 1_800_000, maxTurns: 3 })
  dispose = render(() => <TimeBudgetField label="Timeout" hint="Inherited when empty."
    budget={budget()} onChange={setBudget} />, document.body)
  const input = document.querySelector('input')!
  expect(input.value).toBe('30')
  input.value = '45.5'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(budget()).toEqual({ maxWallTimeMs: 2_730_000, maxTurns: 3 })
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(budget()).toEqual({ maxTurns: 3 })
})

it('removes an empty budget and reports invalid or widening timeouts', () => {
  const [budget, setBudget] = createSignal<WorkflowBudget | undefined>()
  dispose = render(() => <TimeBudgetField label="Timeout" hint="Inherited when empty."
    budget={budget()} maxWallTimeMs={600_000} onChange={setBudget} />, document.body)
  const input = document.querySelector('input')!
  input.value = '0'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('greater than zero')
  input.value = '20'
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('fit within the workflow timeout')
  input.value = ''
  input.dispatchEvent(new Event('input', { bubbles: true }))
  expect(budget()).toBeUndefined()
  expect(document.querySelector('[role="alert"]')).toBeNull()
})
