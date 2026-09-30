import { render } from 'solid-js/web'
import { describe, expect, it, vi } from 'vitest'
import { installKeymap } from '../../../host/keys/install'
import { keymap, setKeymap } from '../../keys/keymapHost'
import { Textarea } from './Textarea'

describe('Textarea commit', () => {
  it.each([
    ['Command-Enter', 'super', { metaKey: true }],
    ['Control-Enter', 'ctrl', { ctrlKey: true }],
  ] as const)('calls onCommit with %s while Enter remains a newline', (_label, primary, modifier) => {
    const keymapDispose = render(() => {
      installKeymap(document.documentElement, { prefs: () => ({ taskActive: false }), bindings: () => [] })
      return null
    }, document.createElement('div'))
    const restore = setKeymap(keymap()!, { primary, typing: () => true })
    const host = document.createElement('div')
    document.body.append(host)
    const onCommit = vi.fn()
    const dispose = render(() => <Textarea value="Question" onCommit={onCommit} />, host)

    try {
      const field = host.querySelector('textarea')!
      field.focus()
      const press = (options: KeyboardEventInit = {}) => field.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, ...options,
      }))
      expect(press()).toBe(true)
      expect(onCommit).not.toHaveBeenCalled()
      expect(press(modifier)).toBe(false)
      expect(onCommit).toHaveBeenCalledOnce()
    } finally {
      dispose()
      host.remove()
      restore()
      keymapDispose()
    }
  })
})
