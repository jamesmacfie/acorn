import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ExtensionPointsDev from './ExtensionPointsDev'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../registries/extensionPoints'
import type { Disposable } from '../registries/registry'

// The screen that exists because everything else is silent (docs/plugins.md § Seeing what matched).
//
// An unmatched contribution draws nothing and throws nothing, which is right for a user and the worst
// possible thing for an author: a typo in `point` produces an empty pane and no error. What a render
// adds over the registry's own unit tests is that all three cases reach the page — a point that is
// filled, a point that nobody fills, and a contribution whose point nobody declared.

vi.mock('../hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ data: {} }),
  useQueryClient: () => ({}),
}))
vi.mock('../queries', () => ({ prefsOptions: () => ({}) }))
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
    expect(text()).toContain('No plugin here has opened a point')
    expect(text()).toContain('Everything contributed here has somewhere to go')
  })

  it('names who fills a point, and says so when nobody does', () => {
    point('board:card-links', 'rows')
    point('board:empty', 'rows')
    contribution('tracker', 'board:card-links', 'items')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('filled by tracker')
    expect(text()).toContain('nobody fills it')
  })

  it('names a contribution whose point nobody declared, and guesses what was meant', () => {
    point('board:card-links', 'rows')
    contribution('tracker', 'board:card-link', 'items')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('tracker → board:card-link')
    expect(text()).toContain('no plugin on this node declares that point')
    expect(text()).toContain('did you mean board:card-links?')
  })

  it('names a contribution whose carrier the point does not take', () => {
    point('board:card-links', 'rows')
    contribution('tracker', 'board:card-links', 'remote')
    dispose()
    dispose = render(() => <ExtensionPointsDev />, host)
    expect(text()).toContain('that point takes rows, and this contributes remote')
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
})
