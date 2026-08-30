import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Slot } from '../tree/Slot'
import { extensionPointRegistry, extensionRegistry } from '../registries/extensionPoints/extensionPoints'
import type { Disposable } from '../../kit/lib/registry'

// The direct render path into a slot: a compiled plugin's component, mounted where a loaded plugin's
// worker tree would go (docs/plugins.md § Cooperative extension points, "two render paths").
//
// The shape under test is context and memory, which is the pair phase 6 of the layout programme moved
// onto this seam: context opens `context:section` and draws its own rows as the default children;
// memory contributes a component that matches the `memory` section only. What has to be true is
// everything a person would notice — memory's form appears under its own section and nowhere else,
// context's own rows stay put beside it because the point stacks, and disabling memory leaves context
// drawing exactly what it drew before anybody contributed.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({}) }))
// The worker path is not what this file is about, and mounting one in jsdom would need a Worker.
vi.mock('../tree/RemoteTree', () => ({ RemoteTree: () => <span>worker-tree</span> }))

const registered: Disposable[] = []

const point = () =>
  registered.push(extensionPointRegistry.register({
    id: 'context:section',
    ownerId: 'context',
    label: 'Context section',
    kind: 'remote',
    mode: 'stack',
    max: 2,
  }))

const memory = () =>
  registered.push(extensionRegistry.register({
    id: 'memory.section',
    pluginId: 'memory',
    point: 'context:section',
    label: 'Memory proposals',
    order: 10,
    carrier: 'component',
    matches: ['memory'],
    component: (props: { section: string }) => <span>memory-form:{props.section}</span>,
  }))

const draw = (element: () => import('solid-js').JSX.Element) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(element, host)
  const text = host.textContent ?? ''
  dispose()
  host.remove()
  return text
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
})

const section = (key: string) => () => (
  <Slot point="context:section" key={key} props={() => ({ section: key })}>
    rows:{key}
  </Slot>
)

describe('a compiled contribution in a slot', () => {
  it('mounts the contributor’s component where a worker tree would go', () => {
    point()
    memory()
    expect(draw(section('memory'))).toContain('memory-form:memory')
  })

  it('hands it the owner’s own props, by the owner’s own names', () => {
    point()
    memory()
    // `memory-form:memory` and not `memory-form:` — the `section` prop crossed as an ordinary prop
    // rather than as a serialized payload, which is the difference between the two paths.
    expect(draw(section('memory'))).toBe('rows:memorymemory-form:memory')
  })

  it('keeps the owner’s default rows, because the point stacks', () => {
    point()
    memory()
    expect(draw(section('memory'))).toContain('rows:memory')
  })

  it('draws nothing extra under a section the contributor did not match', () => {
    point()
    memory()
    expect(draw(section('notes'))).toBe('rows:notes')
  })

  it('leaves the owner drawing its own rows when the contributor is disabled', () => {
    point()
    // No contribution registered at all, which is what disabling the memory plugin produces: the host
    // disposes its registrations.
    expect(draw(section('memory'))).toBe('rows:memory')
  })
})
