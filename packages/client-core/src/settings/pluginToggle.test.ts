import { describe, expect, it } from 'vitest'
import type { NodePluginRow } from '@acorn/protocol/api.ts'
import { nextDisabledList, pluginPending } from './pluginToggle'

const row = (name: string, over: Partial<NodePluginRow> = {}): NodePluginRow =>
  ({ name, required: false, disabled: false, running: true, state: 'active', ...over })

const ROWS: NodePluginRow[] = [
  row('github'),
  row('docker'),
  row('rollbar', { disabled: true, running: false }),
  row('linear'),
]

describe('nextDisabledList', () => {
  it('adds a name while keeping the others, sorted by nothing in particular but stable', () => {
    // The route takes the WHOLE list, so a toggle is a recompute rather than a flag flip — which is the
    // trap: dropping the rows that were already off would silently re-enable them.
    expect(nextDisabledList(ROWS, 'docker', true)).toEqual(['rollbar', 'docker'])
  })

  it('removes a name without disturbing the rest', () => {
    expect(nextDisabledList(ROWS, 'rollbar', false)).toEqual([])
    expect(nextDisabledList([...ROWS, row('http', { disabled: true, running: false })], 'rollbar', false)).toEqual(['http'])
  })

  it('is idempotent, because double-clicking a checkbox is easy', () => {
    expect(nextDisabledList(ROWS, 'rollbar', true)).toEqual(['rollbar'])
    expect(nextDisabledList(ROWS, 'docker', false)).toEqual(['rollbar'])
  })

  it('refuses a required plugin instead of sending a list the route will reject', () => {
    const rows = [...ROWS, row('terminal', { required: true })]
    expect(() => nextDisabledList(rows, 'terminal', true)).toThrow(/required plugin/)
  })

  it('never carries a required plugin through from the rows', () => {
    const stale = [row('terminal', { required: true, disabled: true }), row('docker')]
    expect(nextDisabledList(stale, 'docker', true)).toEqual(['docker'])
  })
})

describe('pluginPending', () => {
  it('is true exactly when what will run differs from what is running', () => {
    expect(pluginPending(row('a'))).toBe(false) // enabled and running
    expect(pluginPending(row('b', { disabled: true, running: false }))).toBe(false) // off and not loaded
    expect(pluginPending(row('c', { disabled: true, running: true }))).toBe(true) // just turned off
    expect(pluginPending(row('d', { disabled: false, running: false }))).toBe(true) // just turned back on
  })
})
