import { describe, expect, it } from 'vitest'
import { resolveKeybindings, type KeybindingContribution } from './keybindings'

const binding = (partial: Partial<KeybindingContribution> & Pick<KeybindingContribution, 'id' | 'defaultChord'>): KeybindingContribution => ({
  command: partial.id,
  description: partial.id,
  category: 'Test',
  when: 'global',
  ...partial,
})

describe('resolveKeybindings', () => {
  it('leaves the later global conflict unbound and identifies its owner', () => {
    const resolved = resolveKeybindings([binding({ id: 'first', defaultChord: 'meta+k' }), binding({ id: 'last', defaultChord: 'meta+k' })])
    expect(resolved[0].chord).toBe('meta+k')
    expect(resolved[1]).toMatchObject({ chord: null, conflict: 'first' })
  })

  it('allows the same chord in different pane scopes but not against task scope', () => {
    const panes = resolveKeybindings([
      binding({ id: 'one', defaultChord: 'meta+f', when: 'pane', pane: 'pr' }),
      binding({ id: 'two', defaultChord: 'meta+f', when: 'pane', pane: 'editor' }),
    ])
    expect(panes.map((item) => item.chord)).toEqual(['meta+f', 'meta+f'])
    const task = resolveKeybindings([...panes, binding({ id: 'task', defaultChord: 'meta+f', when: 'task' })])
    expect(task[2].conflict).toBe('one')
  })

  it('applies generalized overrides and legacy pane overrides without dropping explicit unbound state', () => {
    const bindings = [binding({ id: 'pane.pr', defaultChord: 'meta+r', legacyPaneAction: 'pr' })]
    expect(resolveKeybindings(bindings, { pane_shortcuts: '{"pr":"meta+p"}' })[0].chord).toBe('meta+p')
    expect(resolveKeybindings(bindings, { keybindings: '{"pane.pr":null}', pane_shortcuts: '{"pr":"meta+p"}' })[0].chord).toBeNull()
  })
})
