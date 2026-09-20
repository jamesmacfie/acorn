import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TypedBindingPicker from './TypedBindingPicker'

let host: HTMLDivElement
let dispose: (() => void) | undefined

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
})
afterEach(() => {
  dispose?.()
  document.querySelectorAll('.repo-picker-popover').forEach(element => element.remove())
  host.remove()
})

describe('TypedBindingPicker', () => {
  it('renders origin groups, missing examples, incompatibility reasons, and unsafe labels as text', async () => {
    const change = vi.fn()
    dispose = render(() => <TypedBindingPicker
      label="Record field"
      destination={{ type: 'number' }}
      origins={[
        { kind: 'input', name: 'issue', label: 'Issue <img src=x>', schema: { type: 'object', properties: { title: { type: 'string' } }, required: [] } },
        { kind: 'item', label: 'Current issue', schema: { type: 'object', properties: { count: { type: 'number' } }, required: ['count'] } },
        { kind: 'step', stepId: 'lookup', label: 'Lookup', schema: { type: 'object', properties: { total: { type: 'number' } }, required: ['total'] } },
      ]}
      onChange={change}
    />, host)
    const trigger = host.querySelector('button') as HTMLButtonElement
    trigger.click()
    await Promise.resolve()
    const popover = document.querySelector('.repo-picker-popover')!
    expect(popover.textContent).toContain('Workflow inputs')
    expect(popover.textContent).toContain('Current record')
    expect(popover.textContent).toContain('Available step results')
    expect(popover.textContent).toContain('No preview value')
    expect(popover.textContent).toContain('string cannot be used where number is required')
    expect(popover.querySelector('img')).toBeNull()
  })
})
