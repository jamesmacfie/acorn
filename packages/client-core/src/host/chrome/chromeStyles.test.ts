import { afterEach, describe, expect, it } from 'vitest'
import { pluginStyleBlock, pluginStyleId, pluginStyleStyleSheet, registerPluginStyle } from './chromeStyles'
import { resolveStyle } from '../../features/settings/uiStyles'

const descriptor = { id: 'dense', label: 'Dense', tokens: { '--row-h': '28px', '--font-mono': '"JetBrains Mono", monospace' } }
const disposers: Array<() => void> = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })

describe('plugin styles', () => {
  it('generates only a namespaced token block', () => {
    expect(pluginStyleBlock(pluginStyleId('board', 'dense'), descriptor)).toBe(
      ':root[data-style="plugin:board:dense"] {\n  --font-mono: "JetBrains Mono", monospace;\n  --row-h: 28px;\n}',
    )
  })

  it('refuses the entire pack when any token is invalid', () => {
    expect(() => registerPluginStyle('board', { ...descriptor, tokens: { '--row-h': '28px', '--shadow-2': '0 4px 8px red' } })).toThrow()
    expect(pluginStyleStyleSheet()).toBe('')
    expect(() => pluginStyleBlock('plugin:board:dense', { ...descriptor, tokens: { '--surface-border': '1px solid' } })).toThrow('host-derived')
  })

  it('falls back without changing the saved id, and resumes when registered', () => {
    const stored = 'plugin:board:dense'
    expect(resolveStyle(stored)).toBe('terminal')
    const registered = registerPluginStyle('board', descriptor)
    disposers.push(() => registered.dispose())
    expect(resolveStyle(stored)).toBe(stored)
    expect(pluginStyleStyleSheet()).toContain('--row-h: 28px')
    registered.dispose()
    disposers.pop()
    expect(resolveStyle(stored)).toBe('terminal')
  })
})
