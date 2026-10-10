import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExtensionPointsDev from './ExtensionPointsDev'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../../host/registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/state/registry'
import { recordTreeFailure } from '../../host/tree/treeFailures'
import { documentServiceRegistry } from '../../host/registries/panes/documentServices'

// The screen that exists because everything else is silent (docs/plugins/cooperative-extension-points.md § Seeing what matched).
//
// An unmatched contribution draws nothing and throws nothing, which is right for a user and the worst
// possible thing for an author: a typo in `point` produces an empty pane and no error. What a render
// adds over the registry's own unit tests is that all three cases reach the page — a point that is
// filled, a point that nobody fills, and a contribution whose point nobody declared.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: {} }),
  useQueryClient: () => ({}),
}))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))
vi.mock('./savePref', () => ({ savePref: vi.fn() }))

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const point = (id: string, kind: 'rows' | 'remote', mode?: 'stack' | 'replace') =>
  registered.push(extensionPointRegistry.register({
    id,
    ownerId: id.split(':')[0]!,
    label: 'Ports',
    kind,
    max: 4,
    ...(kind === 'rows' ? { location: 'pane.footer' as const, surface: 'board' } : {}),
    ...(mode ? { mode } : {}),
  }))

const contribution = (pluginId: string, pointId: string, carrier: ExtensionContribution['carrier']) =>
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:x`,
    pluginId,
    point: pointId,
    label: `${pluginId} rows`,
    order: 500,
    carrier,
    ...(carrier === 'items' ? { fetch: async () => [] } : { entry: 'draw', hash: 'abc' }),
  } as ExtensionContribution))

beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ExtensionPointsDev />, host)
})

afterEach(() => {
  dispose()
  host.remove()
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
})

const text = () => host.textContent ?? ''

describe('ExtensionPointsDev', () => {
  it('says nothing is open when nothing is', () => {
    expect(text()).toContain('No plugin offers an extension point')
    expect(text()).toContain('Everything contributed here has somewhere to go')
  })

  it('names who fills a point, and says so when nobody does', () => {
    point('board:card-links', 'rows')
    point('board:empty', 'rows')
    contribution('tracker', 'board:card-links', 'items')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('Used by tracker.')
    expect(text()).toContain('Not used.')
  })

  it('names a contribution whose point nobody declared, and guesses what was meant', () => {
    point('board:card-links', 'rows')
    contribution('tracker', 'board:card-link', 'items')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('tracker → board:card-link')
    expect(text()).toContain('No plugin on this node declares that point.')
    expect(text()).toContain('Did you mean board:card-links?')
  })

  it('names a contribution whose carrier the point does not take', () => {
    point('board:card-links', 'rows')
    contribution('tracker', 'board:card-links', 'remote')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('That point takes rows, and this contributes remote.')
  })

  it('offers a picker only where two contributors are tied for one replace slot', () => {
    point('agents:attachment', 'remote', 'replace')
    contribution('images', 'agents:attachment', 'remote')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).not.toContain('Which plugin draws this')

    contribution('thumbs', 'agents:attachment', 'remote')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('Which plugin draws this')
    expect(text()).toContain('agents’s own')
  })

  it('lists who answers a language, and offers a pick only on a tie', () => {
    const provide = (pluginId: string) => registered.push(documentServiceRegistry.register({
      id: `${pluginId}:json`, pluginId, label: `${pluginId} check`, languageId: 'json', diagnostics: `/v1/p/${pluginId}/check`, available: () => true,
    }))
    provide('lint')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('lint check (lint).')
    expect(text()).not.toContain('Which plugin answers diagnostics for json')

    provide('schema')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('Which plugin answers diagnostics for json')
  })

  // What an author can't see from the owner's screen: how many fit, what the owner will do when asked,
  // which keys a contributor answers to, and why a tree that should be there drew nothing.
  it('shows a point’s cap and actions, and each contributor’s keys and last failure', () => {
    registered.push(extensionPointRegistry.register({
      id: 'preview:toolbar', ownerId: 'preview', label: 'Toolbar', kind: 'remote', mode: 'stack', max: 4, actions: ['reload'],
    }))
    registered.push(extensionRegistry.register({
      id: 'plugin:docs:toolbar', pluginId: 'docs', point: 'preview:toolbar', label: 'Docs button', order: 500,
      carrier: 'remote', entry: 'draw', hash: 'abc', matches: ['*.md', '*.markdown'],
    }))
    recordTreeFailure('plugin:docs:toolbar', 'worker stopped answering')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('up to 4')
    expect(text()).toContain('Contributors can ask it to: reload.')
    expect(text()).toContain('Docs button (docs) draws *.md, *.markdown.')
    expect(text()).toContain('Last failed: worker stopped answering')
  })

  it('says where the host draws a point an owner mounted in a detail region', () => {
    registered.push(extensionPointRegistry.register({
      id: 'linear:issue-summary', ownerId: 'linear', label: 'Issue summary', kind: 'remote', mode: 'stack', max: 2,
      mounts: [{ surface: 'linear-issue', region: 'header' }, { surface: 'linear-ref', region: 'header' }],
    }))
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('Drawn at the header of linear-issue, the header of linear-ref.')
  })
})
