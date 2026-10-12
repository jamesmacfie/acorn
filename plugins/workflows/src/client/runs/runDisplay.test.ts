import { expect, it } from 'vitest'
import type { WorkflowStepRow } from '../../contract/wire.ts'
import { stepProgressLine } from './runDisplay'

const step = (over: Partial<WorkflowStepRow>): WorkflowStepRow =>
  ({ id: 'step', status: 'running', inputsJson: null, ...over }) as WorkflowStepRow

it('shows the latest progress event under any running step', () => {
  const events = [
    { type: 'progress', text: 'First' },
    { type: 'stdout', text: 'noise' },
    { type: 'progress', text: 'Latest' },
  ]
  expect(stepProgressLine(step({}), events)).toBe('Latest')
  expect(stepProgressLine(step({ status: 'done' }), events)).toBeUndefined()
})

it("reads a polling gate's saved wait, so a reload shows it before the next poll", () => {
  const wait = { since: 1, deadlineAt: 2, polls: 3, state: 'polling', detail: 'Checks running: 9 of 12 finished.' }
  expect(stepProgressLine(step({ inputsJson: JSON.stringify({ policyWait: wait }) }), [])).toBe(
    'Waiting: Checks running: 9 of 12 finished. 3 checks so far, checking now.',
  )
})
