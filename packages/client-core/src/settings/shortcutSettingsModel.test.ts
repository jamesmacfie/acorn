import { describe, expect, it } from 'vitest'
import type { KeybindingContribution } from '../registries/keybindings'
import { orphanedPluginOverrideIds, removeOverrideIds, visibleShortcutBindings } from './shortcutSettingsModel'

const binding = (id: string, state?: 'enabled' | 'disabled' | 'absent'): KeybindingContribution => ({
  id,
  command: id,
  description: id,
  category: 'Test',
  defaultChord: 'meta+x',
  ...(state ? { plugin: { id: 'board', name: 'Board', installedAt: () => 1, state: () => state } } : {}),
})

describe('shortcut settings lifecycle', () => {
  it('shows disabled plugins but hides plugins absent from the active node', () => {
    expect(visibleShortcutBindings([binding('core'), binding('disabled', 'disabled'), binding('absent', 'absent')]).map((item) => item.id))
      .toEqual(['core', 'disabled'])
  })

  it('identifies only unmatched plugin overrides as explicit cleanup candidates', () => {
    expect(orphanedPluginOverrideIds(
      { core: 'meta+c', 'plugin.board.live': 'meta+l', 'plugin.old.gone': null },
      [binding('core'), binding('plugin.board.live', 'enabled')],
    )).toEqual(['plugin.old.gone'])
  })

  it('removes one group without touching another', () => {
    expect(removeOverrideIds({ global: 'meta+g', pane: 'meta+p', plugin: null }, ['pane', 'plugin']))
      .toEqual({ global: 'meta+g' })
  })
})
