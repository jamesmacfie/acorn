import { describe, expect, it } from 'vitest'
import type { QueryClient } from '@tanstack/solid-query'
import type { DocumentHandle } from '../../features/editor/documentModel'
import type { FrameBinding } from '../frames/broker'
import { refreshTreeDocumentGrant, treeAuthorityKey, treeDocumentGrant, treeModelAuthorityKey } from './bridgeAuthority'

const binding = (): FrameBinding => ({ pluginId: 'http', surface: 'http', target: 'pane', nodeId: 'node-a', api: ['/v1/p/http/*'], events: [], panes: [], destinations: [], claimsKeys: [] })
const context = { surface: 'http', target: 'remote' as const, theme: 'light', style: 'terminal', nodeId: 'node-a' }
const handle = (): DocumentHandle => ({ read: () => 'sql', write: () => {}, flush: async () => {} }) as DocumentHandle

describe('tree model identity and permanent structural grant generations', () => {
  it('shares models across opening selections without changing immutable legacy metadata', () => {
    const qc = {} as QueryClient
    const first = { ...context, item: 'first' }
    const second = { ...context, item: 'second' }
    expect(treeModelAuthorityKey('hash', qc, binding(), first, undefined)).toBe(treeModelAuthorityKey('hash', qc, binding(), second, undefined))
    expect(treeAuthorityKey('hash', qc, binding(), first, undefined)).not.toBe(treeAuthorityKey('hash', qc, binding(), second, undefined))
    expect(treeModelAuthorityKey('hash', {} as QueryClient, binding(), first, undefined)).not.toBe(treeModelAuthorityKey('hash', qc, binding(), first, undefined))
  })

  it('includes all effective permissions and target in immutable affinity', () => {
    const qc = {} as QueryClient
    const original = binding()
    const key = treeAuthorityKey('hash', qc, original, context, undefined)
    for (const change of [{ target: 'overlay' }, { hosts: ['host'] }, { destinations: [{ id: 'other', targetKind: 'task' }] }, { claimsKeys: ['escape'] }, { api: ['other'] }, { events: ['tasks:changed'] }, { panes: ['other'] }]) {
      expect(treeAuthorityKey('hash', qc, { ...original, ...change } as FrameBinding, context, undefined)).not.toBe(key)
    }
  })

  it('admits delayed first readiness, revokes permanently through null and same-handle return', () => {
    let current: DocumentHandle | null = null
    const accessor = () => current
    const first = treeDocumentGrant(accessor)!
    const sibling = treeDocumentGrant(accessor)!
    expect(first()).toBeNull()
    current = handle()
    refreshTreeDocumentGrant(accessor)
    expect(first()).toBe(current)
    expect(sibling()).toBe(current)
    const original = current
    current = null
    refreshTreeDocumentGrant(accessor)
    current = original
    refreshTreeDocumentGrant(accessor)
    expect(first).toThrow('retired')
    expect(sibling).toThrow('retired')
    const replacement = treeDocumentGrant(accessor)!
    expect(replacement()).toBe(original)
    expect(first).toThrow('retired')
    expect(replacement()).toBe(original)
  })

  it('rekeys replacement handles even when no old bridge request observes the withdrawal', () => {
    const qc = {} as QueryClient
    let current: DocumentHandle | null = handle()
    const accessor = () => current
    const oldKey = treeModelAuthorityKey('hash', qc, binding(), context, accessor)
    const retired = treeDocumentGrant(accessor)!
    current = null
    refreshTreeDocumentGrant(accessor)
    current = handle()
    refreshTreeDocumentGrant(accessor)
    expect(treeModelAuthorityKey('hash', qc, binding(), context, accessor)).not.toBe(oldKey)
    expect(retired).toThrow('retired')
    expect(treeDocumentGrant(accessor)!()).toBe(current)
  })
})
