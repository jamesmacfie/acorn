import { describe, expect, it } from 'vitest'
import { configPatchForPref, deviceConfigInstallOffers, deviceConfigPrefs } from './deviceConfigPrefs'
import { PrefKeys } from './prefKeys'

describe('device config projection', () => {
  it('round trips covered preferences through the device store representation', () => {
    const config = {
      theme: 'dark', style: 'modern', themeFollowSystem: false,
      keybindings: { 'core.settings.open': 'meta+,' },
      railOrder: { pinned: ['t1'], order: ['t2'] },
      leftCollapsed: true,
      exclusiveSlots: { 'pane.switcher': 'board' },
    }
    const prefs = deviceConfigPrefs(config)
    expect(prefs[PrefKeys.style]).toBe('modern')
    expect(prefs[PrefKeys.themeFollowSystem]).toBe('false')
    expect(prefs[PrefKeys.leftCollapsed]).toBe('true')
    expect(configPatchForPref(PrefKeys.railOrder, prefs[PrefKeys.railOrder]!)).toEqual({ railOrder: config.railOrder })
  })

  it('treats plugin declarations as offers and leaves trust outside the projection', () => {
    const config = { plugins: [
      { id: 'board', source: { github: 'owner/board' } },
      { id: 'theme', source: { url: 'https://example.com/theme.tgz' } },
    ] }
    expect(deviceConfigInstallOffers(config, new Set(['board']))).toEqual([config.plugins[1]])
    expect(deviceConfigPrefs(config)).toEqual({})
  })
})
