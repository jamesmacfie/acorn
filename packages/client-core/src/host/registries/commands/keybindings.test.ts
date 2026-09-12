import { describe, expect, it } from 'vitest'
import { keybindingConflict, resolveFrameKeybinding, resolveKeybindings, type KeybindingContribution } from './keybindings'

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

  it('puts first-party defaults ahead of plugin defaults and plugins in stable install order', () => {
    const state = () => 'enabled' as const
    const plugin = (id: string, installedAt: number): KeybindingContribution['plugin'] => ({
      id, name: id, installedAt: () => installedAt, state,
    })
    const core = binding({ id: 'core', defaultChord: 'meta+f' })
    const early = binding({ id: 'plugin.early.search', defaultChord: 'meta+f', plugin: plugin('early', 1) })
    const late = binding({ id: 'plugin.late.search', defaultChord: 'meta+f', plugin: plugin('late', 2) })
    for (const input of [[late, core, early], [early, late, core]]) {
      const resolved = resolveKeybindings(input)
      expect(resolved.find((entry) => entry.id === 'core')?.chord).toBe('meta+f')
      expect(resolved.find((entry) => entry.id === 'plugin.early.search')?.conflict).toBe('core')
      expect(resolved.find((entry) => entry.id === 'plugin.late.search')?.conflict).toBe('core')
    }
  })

  it('lets an explicit user override outrank a first-party default', () => {
    const core = binding({ id: 'core', defaultChord: 'meta+k' })
    const plugin = binding({
      id: 'plugin.board.search', defaultChord: 'meta+f',
      plugin: { id: 'board', name: 'Board', installedAt: () => 1, state: () => 'enabled' },
    })
    const resolved = resolveKeybindings([core, plugin], { keybindings: '{"plugin.board.search":"meta+k"}' })
    expect(resolved.find((entry) => entry.id === 'plugin.board.search')?.chord).toBe('meta+k')
    expect(resolved.find((entry) => entry.id === 'core')).toMatchObject({ chord: null, conflict: 'plugin.board.search' })
  })

  it('keeps inactive defaults out of dispatch conflicts but includes them in save-time warnings', () => {
    const inactive = binding({ id: 'plugin.off.x', defaultChord: 'meta+x', active: () => false })
    const active = binding({ id: 'core', defaultChord: 'meta+x' })
    expect(resolveKeybindings([inactive, active]).map((entry) => entry.chord)).toEqual(['meta+x', 'meta+x'])
    expect(keybindingConflict('core', 'meta+x', [inactive, active], {})?.conflict).toBe('plugin.off.x')
  })

  it('prefers this frame’s surface binding when resolving a forwarded chord', () => {
    const surface = binding({
      id: 'plugin.board.search', defaultChord: 'meta+f', when: 'pane', pane: 'board',
      plugin: { id: 'board', name: 'Board', installedAt: () => 1, state: () => 'enabled' },
    })
    const global = binding({ id: 'global', defaultChord: 'meta+f' })
    const resolved = [
      { ...global, chord: 'meta+f' },
      { ...surface, chord: 'meta+f' },
    ]
    expect(resolveFrameKeybinding('meta+f', resolved, { pluginId: 'board', surface: 'board', taskActive: true })?.id)
      .toBe('plugin.board.search')
  })
})
