import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Slot } from './Slot'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../../registries/extensionPoints'
import type { Disposable } from '../../registries/registry'

// A place in one plugin's tree where another plugin's tree may be grafted (docs/plugins.md §
// Cooperative extension points, the `remote` kind).
//
// The arbitration rule itself is unit-tested next door in `arbitration.test.ts`; what a render adds is
// the facts a person would see: the owner's default draws when nobody matches and while a tie is
// undecided, and a stack past `max` says how many were left out.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))

// The tree itself is the worker path, tested in TreeHost/workerHost. Here it only has to be
// identifiable on screen.
vi.mock('./RemoteTree', () => ({
  RemoteTree: (props: { contribution: { pluginId: string }; scope?: () => { taskId?: string } }) => (
    <span>tree:{props.contribution.pluginId}{props.scope?.().taskId ? ` in ${props.scope!().taskId}` : ''}</span>
  ),
}))

const registered: Disposable[] = []

const point = (over: { id?: string; mode?: 'stack' | 'replace'; max?: number } = {}) =>
  registered.push(extensionPointRegistry.register({
    id: over.id ?? 'agents:attachment',
    ownerId: 'agents',
    label: 'Attachment',
    kind: 'remote',
    mode: over.mode ?? 'replace',
    max: over.max ?? 4,
  }))

const contributor = (pluginId: string, pointId: string, matches?: string[]) =>
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:draw`,
    pluginId,
    point: pointId,
    label: `${pluginId} viewer`,
    order: 500,
    carrier: 'remote',
    entry: 'draw',
    hash: 'abc',
    ...(matches ? { matches } : {}),
  } as ExtensionContribution))

const draw = (element: () => Parameters<typeof render>[0]) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(element(), host)
  const text = host.textContent ?? ''
  dispose()
  host.remove()
  return text
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
})

describe('Slot', () => {
  it('draws the owner’s default when the point is not declared here', () => {
    expect(draw(() => () => <Slot point="agents:attachment" key="image/png">default</Slot>)).toBe('default')
  })

  it('draws the owner’s default when nobody matches the key', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    expect(draw(() => () => <Slot point="agents:attachment" key="text/csv">default</Slot>)).toBe('default')
  })

  it('grafts the one contributor that matches', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    expect(draw(() => () => <Slot point="agents:attachment" key="image/png">default</Slot>)).toBe('tree:images')
  })

  it('draws the owner’s default while two contributors are tied and nobody has picked', () => {
    point()
    contributor('images', 'agents:attachment', ['image/*'])
    contributor('thumbs', 'agents:attachment', ['image/png'])
    expect(draw(() => () => <Slot point="agents:attachment" key="image/png">default</Slot>)).toBe('default')
  })

  it('stacks up to the owner’s ceiling and discloses the rest as a count', () => {
    point({ id: 'agents:composer-actions', mode: 'stack', max: 2 })
    for (const id of ['a', 'b', 'c']) contributor(id, 'agents:composer-actions')
    const text = draw(() => () => <Slot point="agents:composer-actions">default</Slot>)
    expect(text).toContain('tree:a')
    expect(text).toContain('tree:b')
    expect(text).not.toContain('tree:c')
    // A count and no names: the owner set the ceiling because it is the owner's screen.
    expect(text).toContain('1 more from other plugins')
  })

  it('hands the contributor’s tree the owner’s task, so a card drawn in a pane is not inert', () => {
    // Without a subject the tree's bridge has no `taskId`, and `openPane`, in-app `openUrl` and every
    // task-scoped key binding answer `undefined` (../frames/frameServices.ts). The owner's task, never
    // the ambient one: a project pane and a reference panel are not looking at a task even while one is
    // selected in the rail behind them.
    point()
    contributor('images', 'agents:attachment', ['image/png'])
    expect(draw(() => () => <Slot point="agents:attachment" key="image/png" taskId="t-42">default</Slot>))
      .toBe('tree:images in t-42')
    // And an owner with no task to give says so rather than inventing one.
    expect(draw(() => () => <Slot point="agents:attachment" key="image/png">default</Slot>)).toBe('tree:images')
  })

  it('has no way to nest, because a contributor’s tree cannot name a Slot', () => {
    // The one-level rule is enforced by the wire vocabulary rather than by a runtime guard: a grafted
    // subtree is a stream of kit node names and `Slot` is not one of them. What this holds is the
    // consequence — a slot in the *owner's* own default children is ordinary tree and still resolves,
    // because the owner is not a contributor to itself.
    point()
    point({ id: 'agents:tool-card' })
    contributor('cards', 'agents:tool-card', ['bash'])
    const text = draw(() => () => (
      <Slot point="agents:attachment" key="text/csv">
        <Slot point="agents:tool-card" key="bash">inner</Slot>
      </Slot>
    ))
    expect(text).toBe('tree:cards')
  })
})
