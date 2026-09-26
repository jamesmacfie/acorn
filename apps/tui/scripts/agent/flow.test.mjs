import { expect, test } from 'vitest'
import { validateFlow } from './flow.mjs'

test('flows reject scripts, unknown actions, and unbounded waits', () => {
  expect(() => validateFlow({ name: 'bad', steps: [{ action: 'press', key: 'j', script: 'process.exit()' }] })).toThrow()
  expect(() => validateFlow({ name: 'bad', steps: [{ action: 'eval', code: '1 + 1' }] })).toThrow()
  expect(() => validateFlow({ name: 'bad', steps: [{ action: 'wait', text: 'ready', timeoutMs: 1_000_000 }] })).toThrow()
  expect(() => validateFlow({ name: 'bad', steps: [{ action: 'press', key: 'j' }] })).toThrow()
})

test('a bounded navigation flow declares visible outcomes', () => {
  expect(validateFlow({ name: 'navigation', steps: [
    { action: 'press', key: 'w' },
    { action: 'wait', text: 'Side project' },
    { action: 'assert', contains: ['Side project'], absent: ['Unexpected'] },
  ] }).steps).toHaveLength(3)
})
