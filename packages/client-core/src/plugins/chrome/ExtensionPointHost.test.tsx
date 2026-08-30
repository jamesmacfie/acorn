import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginExtensionItem } from '@acorn/protocol/extensionPoints.ts'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../../registries/extensionPoints'
import type { Disposable } from '../../registries/registry'
import ExtensionPointHost from './ExtensionPointHost'

// The one place another plugin's rows are drawn inside a plugin's surface, by the host, with the
// shell's own primitives, from data. What a render adds over the registry's own unit tests is the two
// facts the design turns on: an owner who reserved a strip nobody fills sees their pane exactly as it
// was, and every delivered group carries the contributor's id on screen.

const capabilities = vi.hoisted(() => ({ desktop: true, terminal: true }))
vi.mock('../../infra/node/hostCapabilities', () => ({
  hasHostCapability: (requirement: 'none' | 'desktop' | 'terminal' = 'none') =>
    requirement === 'none' || capabilities[requirement],
}))
vi.mock('../../infra/node/activeNode', () => ({ activeNodeId: () => 'node-1' }))

// The fan-out is the node-fetch machinery, not this host's decision. Stub it to whatever the
// contribution's own `fetch` answers, synchronously, so the assertions are about the rows.
const rows = vi.hoisted(() => new Map<string, PluginExtensionItem[]>())
vi.mock('../../infra/node/fanout', () => ({
  createFleetQuery: (key: () => readonly unknown[]) => [() => ({ rows: [{ data: rows.get(String(key()[1])) ?? [] }] })],
}))
vi.mock('./data', () => ({ chromeDeps: () => 0, chromeKey: (pluginId: string, id: string) => ['chrome', id, pluginId] }))

let host: HTMLElement
let dispose: () => void
const registered: Disposable[] = []

const point = (id: string, when?: () => boolean) =>
  registered.push(
    extensionPointRegistry.register({
      id,
      ownerId: id.split(':')[0],
      label: 'Ports',
      // `pane.footer` is the only location that takes deliveries today (`takesPluginExtensions`).
      kind: 'rows' as const,
      location: 'pane.footer' as const,
      max: 4,
      surface: 'containers',
      ...(when ? { when } : {}),
    }),
  )

const delivery = (contribution: Partial<ExtensionContribution> & Pick<ExtensionContribution, 'id' | 'pluginId' | 'point'>) =>
  registered.push(
    extensionRegistry.register({
      label: 'Preview',
      order: 0,
      // The carrier is what the delivery filter matches against a point's kind, so it belongs on every
      // fixture rather than only on the ones testing arbitration.
      carrier: 'items' as const,
      fetch: async () => rows.get(contribution.id) ?? [],
      ...contribution,
    } as ExtensionContribution),
  )

const mount = (pointId: string) => {
  host = document.createElement('div')
  document.body.append(host)
  dispose = render(() => <ExtensionPointHost pointId={pointId} />, host)
}

beforeEach(() => {
  capabilities.desktop = true
  rows.clear()
})

afterEach(() => {
  dispose?.()
  host?.remove()
  for (const handle of registered.splice(0)) handle.dispose()
})

describe('ExtensionPointHost', () => {
  it('draws no chrome at all for a point nobody fills', () => {
    point('docker:containers')

    mount('docker:containers')

    // An owner who reserved a strip and got no takers must see their pane exactly as it was, not an
    // empty bordered section.
    expect(host.innerHTML).toBe('')
  })

  it('still draws the strip when a registered contributor has no rows to send', () => {
    point('docker:containers')
    delivery({ id: 'preview:ports', pluginId: 'preview', point: 'docker:containers' })

    mount('docker:containers')

    // Recording what happens rather than what would be nicer. `Show` here asks whether anybody is
    // registered for the point, not whether anybody sent a row, so a contributor whose fetch comes
    // back empty leaves the wrapper behind. `.extension-point` carries `border-top: var(--divider)`
    // and `background: var(--bg-subtle)`, so on a pack with a visible divider that is a hairline
    // across the bottom of the owner's pane with nothing under it.
    //
    // Closing it means the host knowing each contributor's row count, and the count lives inside the
    // per-contributor query in `ExtensionGroup`. Lifting it makes the host run every contributor's
    // fetch itself, which is a design change rather than a fix.
    expect(host.querySelector('.extension-point')).not.toBeNull()
    expect(host.querySelector('.extension-group')).toBeNull()
  })

  it('draws one group per contributor, ordered, each stamped with its plugin id', () => {
    point('docker:containers')
    delivery({ id: 'z-preview', pluginId: 'preview', point: 'docker:containers', label: 'Preview', order: 1 })
    delivery({ id: 'a-http', pluginId: 'http', point: 'docker:containers', label: 'Saved requests', order: 0 })
    rows.set('z-preview', [{ id: 'p1', title: 'localhost:3000' }])
    rows.set('a-http', [{ id: 'h1', title: 'GET /health' }])

    mount('docker:containers')

    expect([...host.querySelectorAll('.extension-group-owner')].map((node) => node.textContent)).toEqual(['http', 'preview'])
    // The stamp is drawn, not merely recorded: a reader has to be able to see whose rows these are.
    expect(host.textContent).toContain('Saved requests')
    expect(host.textContent).toContain('GET /health')
  })

  it('delivers nothing when the point owner is not running on this node', () => {
    point('docker:containers', () => false)
    delivery({ id: 'preview:ports', pluginId: 'preview', point: 'docker:containers' })
    rows.set('preview:ports', [{ id: 'p1', title: 'localhost:3000' }])

    mount('docker:containers')

    // A point whose owner is absent has no surface on screen, so it has nothing to deliver into.
    expect(host.innerHTML).toBe('')
  })

  it('runs the contributor\'s verb when a row is activated', () => {
    const ran = vi.fn()
    point('docker:containers')
    delivery({ id: 'preview:ports', pluginId: 'preview', point: 'docker:containers', run: ran })
    rows.set('preview:ports', [{ id: 'p1', title: 'localhost:3000' }])

    mount('docker:containers')
    host.querySelector<HTMLElement>('.extension-group [data-mark], .extension-group button, .extension-group [role="button"]')?.click()

    expect(ran).toHaveBeenCalledTimes(1)
    expect(ran.mock.calls[0][0]).toMatchObject({ id: 'p1' })
  })
})
