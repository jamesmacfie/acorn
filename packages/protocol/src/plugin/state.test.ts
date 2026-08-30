import { describe, expect, it } from 'vitest'
import { parsePluginChannel, pluginChannel, pluginStateKey } from './state'

// The two namespaces a loaded plugin owns, both spelled once here because three sides have to agree:
// the node that stamps them, the renderer that routes them, and the manifest that declares them.

describe('pluginStateKey', () => {
  it('prefixes a plugin\'s own key', () => {
    expect(pluginStateKey('machine-stats', 'public-ip')).toBe('plugin:machine-stats:public-ip')
  })
})

describe('pluginChannel', () => {
  it('round-trips', () => {
    const channel = pluginChannel('machine-stats', 'sample')
    expect(channel).toBe('plugin:machine-stats:sample')
    expect(parsePluginChannel(channel)).toEqual({ pluginId: 'machine-stats', verb: 'sample' })
  })

  it('refuses anything that is not one of ours', () => {
    // Another prefix, including the one it sits a letter away from: `plugins:changed` is core's roster
    // event and must never parse as a plugin called "changed".
    expect(parsePluginChannel('plugins:changed')).toBeNull()
    expect(parsePluginChannel('term:status')).toBeNull()
    // Missing or extra halves. A verb cannot hold the delimiter, so three colons is not two.
    expect(parsePluginChannel('plugin:board')).toBeNull()
    expect(parsePluginChannel('plugin:board:a:b')).toBeNull()
    expect(parsePluginChannel('plugin::sample')).toBeNull()
    expect(parsePluginChannel('plugin:board:')).toBeNull()
  })

  it('holds both halves to the manifest\'s own alphabet', () => {
    // A channel name is manifest input on its way to a renderer, so "it parsed" has to mean "it is a
    // name" rather than "it had two colons in it".
    expect(parsePluginChannel('plugin:Board:sample')).toBeNull()
    expect(parsePluginChannel('plugin:board:Sample')).toBeNull()
    expect(parsePluginChannel('plugin:board:read your secrets')).toBeNull()
    expect(parsePluginChannel('plugin:9board:sample')).toBeNull()
    expect(parsePluginChannel(`plugin:board:${'x'.repeat(65)}`)).toBeNull()
    expect(parsePluginChannel(`plugin:board:${'x'.repeat(64)}`)).not.toBeNull()
  })
})
