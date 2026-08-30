import { render } from 'solid-js/web'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InlineSlot } from './InlineSlot'
import { extensionPointRegistry, extensionRegistry, type ExtensionContribution } from '../../registries/extensionPoints'
import type { Disposable } from '../../registries/registry'

// Another plugin's rectangle, drawn as a sibling region of this one's pane (docs/plugins.md §
// Cooperative extension points, the `rectangle` kind).
//
// The counterpart to `tree/Slot.test.tsx`, and the same division: the arbitration rule is tested next
// door in `arbitration.test.ts`, and what a render adds is what a person would see. What is particular
// to this kind is that every occupant is a whole iframe, so the owner's ceiling is a real limit and a
// point past it has to say so rather than dropping contributors in silence — which is what it did
// until phase 10.
//
// The other half is the gate. An occupant draws only if its own plugin is running here, its bytes are
// trusted on this device, and the surface it named is really an `inline` one. Those are three separate
// answers and each is asked again at draw time, because a trust decision can be withdrawn while the
// pane is open.

vi.mock('../../hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('@tanstack/solid-query', () => ({ createQuery: () => ({ data: {} }) }))
vi.mock('../../queries', () => ({ prefsOptions: () => ({}) }))
vi.mock('../../node/activeNode', () => ({ activeNodeId: () => 'node-1' }))
vi.mock('./register', () => ({ frameBindingFor: (pluginId: string) => ({ pluginId }) }))

// The iframe itself is PluginFrame's to test; here it only has to be identifiable on screen.
vi.mock('./PluginFrame', () => ({
  default: (props: { binding: { pluginId: string } }) => <span>frame:{props.binding.pluginId}</span>,
}))

type Roster = { pluginId: string; trusted: boolean; hash: string; target: string }
let roster: Roster[] = []

vi.mock('../contributions', () => ({
  eligiblePlugins: () => roster.map((entry) => ({
    pluginId: entry.pluginId,
    trusted: entry.trusted,
    hash: entry.hash,
    row: {},
    installed: { contributions: { frames: [{ id: 'preview', target: entry.target }] } },
  })),
}))

const POINT = 'editor:beside'
const registered: Disposable[] = []

const point = (max = 4) =>
  registered.push(extensionPointRegistry.register({
    id: POINT,
    ownerId: 'editor',
    label: 'Beside the document',
    kind: 'rectangle',
    location: 'pane.inline-beside',
    surface: 'editor',
    mode: 'stack',
    max,
  }))

const contributor = (pluginId: string, matches?: string[]) => {
  roster.push({ pluginId, trusted: true, hash: 'abc', target: 'inline' })
  registered.push(extensionRegistry.register({
    id: `plugin:${pluginId}:beside`,
    pluginId,
    point: POINT,
    label: `${pluginId} preview`,
    order: 500,
    carrier: 'frame',
    frame: 'preview',
    ...(matches ? { matches } : {}),
  } as ExtensionContribution))
}

const draw = (key?: string) => {
  const host = document.createElement('div')
  document.body.append(host)
  const dispose = render(() => <InlineSlot point={POINT} key={key} taskId="t1" />, host)
  const text = host.textContent ?? ''
  dispose()
  host.remove()
  return text
}

afterEach(() => {
  for (const disposable of registered.reverse()) disposable.dispose()
  registered.length = 0
  roster = []
})

describe('InlineSlot', () => {
  it('draws nothing for a point nobody declared here', () => {
    contributor('markdown')
    expect(draw('README.md')).toBe('')
  })

  it('draws the contributor whose pattern covers the key', () => {
    point()
    contributor('markdown', ['*.md'])
    contributor('csv', ['*.csv'])
    expect(draw('README.md')).toBe('frame:markdown')
  })

  it('says how many the owner’s ceiling left out, rather than dropping them in silence', () => {
    point(1)
    contributor('markdown')
    contributor('csv')
    contributor('images')
    // One iframe drawn, and the other two disclosed as a count. A rectangle point past its ceiling
    // used to draw the first and say nothing at all about the rest.
    //
    // `csv` is the one drawn because equal orders break on contribution id, which is what makes the
    // answer independent of the sequence the three plugins happened to register in.
    expect(draw('README.md')).toBe('frame:csv2 more from other plugins')
  })

  it('will not draw bytes this device has not accepted', () => {
    point()
    contributor('markdown')
    roster[0]!.trusted = false
    expect(draw('README.md')).toBe('')
  })

  it('will not draw a surface that is not an inline rectangle', () => {
    point()
    contributor('markdown')
    // A pane surface named by a rectangle contribution is a manifest that does not mean what it says;
    // the point places a sibling region, not somebody else's whole pane.
    roster[0]!.target = 'pane'
    expect(draw('README.md')).toBe('')
  })
})
