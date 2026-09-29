import { describe, expect, it } from 'vitest'
import { parseDeviceConfig } from './deviceConfig'

describe('device configuration', () => {
  it('accepts device appearance, keybindings, slot picks and plugin installation requests', () => {
    const parsed = parseDeviceConfig(JSON.stringify({
      style: 'plugin:board:dense',
      keybindings: { 'core.settings.open': 'meta+,' },
      exclusiveSlots: { 'pane.switcher': 'board' },
      plugins: [{ id: 'board', source: { github: 'owner/board' } }],
      future: { setting: true },
    }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.value.future).toEqual({ setting: true })
  })

  it('rejects executable and custody fields', () => {
    for (const key of ['scripts', 'credentials', 'nodeEndpoints', 'plugin:board:state']) {
      expect(parseDeviceConfig(JSON.stringify({ [key]: 'x' })).ok).toBe(false)
    }
  })

  it('reports a JSON parse error with its line and column', () => {
    const parsed = parseDeviceConfig('{\n  "style": "terminal",\n  broken\n}')
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.line).toBe(3)
  })
})
