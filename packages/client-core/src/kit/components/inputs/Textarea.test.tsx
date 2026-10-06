import { render } from 'solid-js/web'
import { createSignal } from 'solid-js'
import { describe, expect, it, vi } from 'vitest'
import { installKeymap } from '../../../host/keys/install'
import { keymap, setKeymap } from '../../keys/keymapHost'
import { Textarea } from './Textarea'
import MentionTextarea from './MentionTextarea'
import { registerCommands } from '../../../host/registries/commands/commands'

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

describe('textarea expand shortcut', () => {
  it.each([
    ['Command', 'super', 'meta', { metaKey: true }],
    ['Control', 'ctrl', 'ctrl', { ctrlKey: true }],
  ] as const)('toggles only the focused field with %s-Shift-Enter before pane maximize',
    async (_label, primary, chordModifier, modifier) => {
      const maximize = vi.fn()
      const commands = registerCommands([{
        id: 'test.maximize', title: 'Maximize pane', category: 'pane', run: maximize,
      }])
      const keymapDispose = render(() => {
        installKeymap(document.documentElement, {
          prefs: () => ({ taskActive: true }),
          bindings: () => [{
            id: 'test.maximize', command: 'test.maximize', description: 'Maximize pane',
            category: 'Panes', defaultChord: `${chordModifier}+shift+enter`,
            chord: `${chordModifier}+shift+enter`, when: 'task',
          }],
        })
        return null
      }, document.createElement('div'))
      const restore = setKeymap(keymap()!, { primary, typing: () => true })
      const host = document.createElement('div')
      document.body.append(host)
      const submit = vi.fn()
      const dispose = render(() => {
        const [expanded, setExpanded] = createSignal(false)
        const [otherExpanded, setOtherExpanded] = createSignal(false)
        const [draft, setDraft] = createSignal('Keep this draft')
        return <>
          <MentionTextarea value={draft()} onInput={setDraft} rows={expanded() ? 18 : 3}
            onToggleExpand={() => setExpanded((current) => !current)} onSubmit={submit} />
          <Textarea value="Another draft" rows={otherExpanded() ? 18 : 3}
            onToggleExpand={() => setOtherExpanded((current) => !current)} />
          <button>Outside the field</button>
        </>
      }, host)
      try {
        const fields = host.querySelectorAll('textarea')
        const field = fields[0]!
        const other = fields[1]!
        field.focus()
        const press = (target: HTMLElement) => target.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, shiftKey: true, ...modifier,
        }))
        expect(press(field)).toBe(false)
        expect(field.rows).toBe(18)
        expect(other.rows).toBe(3)
        expect(field.value).toBe('Keep this draft')
        expect(document.activeElement).toBe(field)
        expect(press(field)).toBe(false)
        expect(field.rows).toBe(3)
        expect(maximize).not.toHaveBeenCalled()
        expect(submit).not.toHaveBeenCalled()

        const outside = host.querySelector('button')!
        outside.focus()
        press(outside)
        await vi.waitFor(() => expect(maximize).toHaveBeenCalledOnce())
        expect(field.rows).toBe(3)
      } finally {
        dispose()
        host.remove()
        restore()
        keymapDispose()
        commands.dispose()
      }
    })
})
