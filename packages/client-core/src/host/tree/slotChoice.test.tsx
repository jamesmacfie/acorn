import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { ACORN_BASELINE } from '@acorn/protocol/baseline.ts'
import { Slot } from './Slot'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../registries/extensionPoints/extensionPoints'
import { prefsKey } from '../../infra/queries'
import type { Disposable } from '../../kit/lib/state/registry'

// The pick is read through a real query client here, because what this file holds is when that query
// exists: not at all while nothing is tied, one per tied slot once something is, gone with the slot,
// and still live, so a new pick redraws the box.

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('./RemoteTree', () => ({
  RemoteTree: (props: { contribution: { pluginId: string } }) => <span>tree:{props.contribution.pluginId}</span>,
}))

// The remote slot picks are a device preference, so the query's `select` reads them from here.
const picks = `acorn-pref:${ACORN_BASELINE}:remote_slots`
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
const registered: Disposable[] = []

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  localStorage.removeItem(picks)
})

const contributor = (pluginId: string) => {
  const registration = extensionRegistry.register({
    id: `plugin:${pluginId}:draw`,
    pluginId,
    point: 'agents:tool-card',
    label: pluginId,
    order: 500,
    carrier: 'remote',
    entry: 'draw',
    hash: 'abc',
  } as ExtensionContribution)
  registered.push(registration)
  return registration
}

it('creates the preferences query only once a tie needs the pick', async () => {
  registered.push(extensionPointRegistry.register({
    id: 'agents:tool-card', ownerId: 'agents', label: 'Tool card', kind: 'remote', mode: 'replace', max: 1,
  }))
  localStorage.setItem(picks, JSON.stringify({ 'agents:tool-card': 'thumbs' }))
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } })
  client.setQueryData(prefsKey, {})
  const observers = () => client.getQueryCache().find({ queryKey: prefsKey })!.observers.length
  const host = document.createElement('div')
  const dispose = render(() => (
    <QueryClientProvider client={client}>
      <Slot point="agents:tool-card" key="bash">card</Slot>
      <Slot point="agents:tool-card" key="read">card</Slot>
    </QueryClientProvider>
  ), host)
  try {
    await settle()
    expect(host.textContent).toBe('cardcard')
    expect(observers()).toBe(0)

    const images = contributor('images')
    await settle()
    expect(host.textContent).toBe('tree:imagestree:images')
    expect(observers()).toBe(0)

    contributor('thumbs')
    await settle()
    expect(host.textContent).toBe('tree:thumbstree:thumbs')
    expect(observers()).toBe(2)

    // A new pick reaches a slot that already made its query.
    localStorage.setItem(picks, JSON.stringify({ 'agents:tool-card': 'images' }))
    client.setQueryData(prefsKey, {})
    await settle()
    expect(host.textContent).toBe('tree:imagestree:images')

    images.dispose()
    await settle()
    expect(host.textContent).toBe('tree:thumbstree:thumbs')
  } finally {
    dispose()
  }
  expect(observers()).toBe(0)
})
