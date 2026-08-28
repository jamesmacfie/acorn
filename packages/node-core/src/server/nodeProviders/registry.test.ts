import { afterEach, describe, expect, it } from 'vitest'
import {
  clearNodeProviders,
  nodeProvider,
  nodeProviderDescriptor,
  nodeProviders,
  registerNodeProvider,
  type NodeProviderContribution,
} from './registry'

// The node-provider registry: id qualification, the create-obliges-destroy rule, and disposal on
// unload (docs/plugins.md § Node providers).

const listOnly = (id = 'file'): NodeProviderContribution => ({ id, label: 'From a file', list: async () => [] })

afterEach(() => {
  for (const provider of nodeProviders()) clearNodeProviders(provider.pluginId)
})

describe('registerNodeProvider', () => {
  it('qualifies the id with the plugin, so nobody registers under a stranger name', () => {
    registerNodeProvider('nodes-file', listOnly())
    expect(nodeProviders().map((provider) => provider.qualifiedId)).toEqual(['nodes-file:file'])
    expect(nodeProvider('nodes-file:file')?.label).toBe('From a file')
    // The plugin's own spelling resolves nothing: every route, body and client row names the qualified
    // form, which is the same rule routes, schedules and capabilities already follow.
    expect(nodeProvider('file')).toBeUndefined()
  })

  it('refuses an id that tries to qualify itself', () => {
    expect(() => registerNodeProvider('nodes-file', listOnly('acme:file'))).toThrow(/must not contain/)
  })

  it('refuses a provider that can create nodes but not remove them', () => {
    // DevPod's rule, and the reason it is checked here rather than at the first click: the moment
    // somebody needs `destroy` is the moment they have already been billed for something.
    const halfProvider = {
      ...listOnly(),
      create: async () => { throw new Error('unused') },
    } as NodeProviderContribution
    expect(() => registerNodeProvider('nodes-file', halfProvider)).toThrow(/must therefore declare destroy/)
    expect(nodeProviders()).toEqual([])
  })

  it('accepts the pair, and reports only the verbs that were declared', () => {
    registerNodeProvider('cloud', {
      ...listOnly('machines'),
      label: 'Acme Cloud',
      create: async () => { throw new Error('unused') },
      destroy: async () => {},
      stop: async () => {},
    })
    expect(nodeProviderDescriptor(nodeProvider('cloud:machines')!)).toEqual({
      id: 'cloud:machines',
      label: 'Acme Cloud',
      // No `start`, so the client offers no Start button. The order is the declaration order in
      // NODE_LIFECYCLE_VERBS, not the object's.
      verbs: ['create', 'destroy', 'stop'],
    })
  })

  it('refuses a duplicate, and an empty id', () => {
    registerNodeProvider('nodes-file', listOnly())
    expect(() => registerNodeProvider('nodes-file', listOnly())).toThrow(/Duplicate/)
    expect(() => registerNodeProvider('nodes-file', listOnly('  '))).toThrow(/empty id/)
  })

  it('drops one plugin\'s providers and leaves the rest', () => {
    registerNodeProvider('nodes-file', listOnly())
    registerNodeProvider('cloud', listOnly('machines'))
    clearNodeProviders('nodes-file')
    expect(nodeProviders().map((provider) => provider.qualifiedId)).toEqual(['cloud:machines'])
  })
})
