import { describe, expect, it } from 'vitest'
import { pluginFunctionMode } from './functionMode'

const sync = () => 'value'
const async = async () => 'value'

describe('pluginFunctionMode', () => {
  it('keeps the synchronous reference contracts synchronous', () => {
    // Both are objects of methods, so the path ends at the method and a rule naming the container
    // matches nothing. `externalRefForConnection` consumes `parse` synchronously, and a promise there
    // reads as a broken reference that refuses every link it stamps.
    expect(pluginFunctionMode('context.providers.integration.externalIds.parse', sync)).toBe('sync')
    expect(pluginFunctionMode('context.providers.integration.externalIds.fromDisplay', sync)).toBe('sync')
    expect(pluginFunctionMode('context.providers.integration.refs.detectRefs', sync)).toBe('sync')
    expect(pluginFunctionMode('context.providers.integration.refs.toRef', sync)).toBe('sync')
    expect(pluginFunctionMode('context.providers.integration.refs.canAutoLink', sync)).toBe('sync')
  })

  it('keeps the synchronous methods synchronous wherever they sit', () => {
    expect(pluginFunctionMode('context.providers.integration.codec.encode', sync)).toBe('sync')
    expect(pluginFunctionMode('context.providers.integration.toPublic', sync)).toBe('sync')
  })

  it('crosses everything else as a promise', () => {
    expect(pluginFunctionMode('context.routes.fetch', sync)).toBe('async')
    expect(pluginFunctionMode('context.providers.integration.resources[0].read', sync)).toBe('async')
    // A container is not a method, so it is not classified as sync.
    expect(pluginFunctionMode('context.providers.integration.externalIds', sync)).toBe('async')
  })

  it('crosses an async function as a promise whatever its name', () => {
    expect(pluginFunctionMode('context.providers.integration.externalIds.parse', async)).toBe('async')
    expect(pluginFunctionMode('plugin.init', sync)).toBe('async')
  })
})
