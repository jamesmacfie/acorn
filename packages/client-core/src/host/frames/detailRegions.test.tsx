import { createComponent, createSignal, onCleanup } from 'solid-js'
import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PLUGIN_API_MAJOR, type NodePluginRow } from '@acorn/protocol/api.ts'
import { registerQueryOwner } from '../../infra/node/queryOwnership'
import type { Disposable } from '../../kit/lib/state/registry'

// The regions a loaded owner mounts above and below its own detail view (docs/plugins/detail-regions.md).
//
// End to end from a roster row: the owner's manifest names the point and its mounts, the frames pass
// wraps the owner's surface, and a contributor's tree is mounted beside the owner's with the subject
// the host bound. The worker path is RemoteTree's own suite; here a tree is a line of text naming who
// drew it and with what props, and a mount and a disposal are counted.

type TreeProps = {
  contribution: { id: string; pluginId: string; entry: string }
  props: () => unknown
  scope?: () => unknown
  onFailed?: (reason: string) => void
}
const mounted: TreeProps[] = []
const disposed: string[] = []

vi.mock('../../infra/node/hostCapabilities', () => ({ hasHostCapability: () => true }))
vi.mock('../components/RefPanelTaskLink', () => ({ default: () => null }))
vi.mock('../tree/RemoteTree', () => ({
  RemoteTree: (props: TreeProps) => {
    mounted.push(props)
    onCleanup(() => disposed.push(props.contribution.id))
    // A tree that fails draws nothing and says so, as the real one does.
    if (props.contribution.entry === 'broken') {
      queueMicrotask(() => props.onFailed?.('worker crashed'))
      return null
    }
    return (
      <span
        data-tree={props.contribution.pluginId}
      >{`${props.contribution.pluginId}:${JSON.stringify(props.props())}`}</span>
    )
  },
}))

const { setActiveNode } = await import('../../infra/node/activeNode')
const { _resetPluginDistribution, _seedPluginDistribution } = await import('../plugins/distribution')
const { syncFrameContributions, _resetFrameContributions } = await import('./register')
const { _resetChromeContributions, syncChromeContributions } = await import('../chrome/chromeRegister')
const { projectSurfaceRegistry } = await import('../registries/panes/projectSurfaces')
const { refPanelRegistry } = await import('../registries/panes/refPanels')
const { extensionRegistry } = await import('../registries/extensionPoints/extensionPoints')

const HASH = 'a'.repeat(64)

const ownerRow = (ownerEntry = 'pane'): NodePluginRow =>
  ({
    name: 'tracker',
    required: false,
    disabled: false,
    running: true,
    state: 'active',
    installed: {
      version: '1.0.0',
      baseline: 'acorn-1',
      apiVersion: PLUGIN_API_MAJOR,
      permissions: {
        api: [],
        events: [],
        node: { core: [], capabilities: [], secrets: false, exec: false, net: [], sockets: false },
      },
      client: { hash: HASH, bytes: 12 },
      contributions: {
        frames: [
          {
            target: 'pane',
            id: 'tracker-issue',
            label: 'Issue',
            order: 500,
            scope: 'project',
            formFactor: ['desktop'],
            claimsKeys: [],
            layout: 'single',
            regions: { body: { kind: 'remote', entry: ownerEntry } },
          },
          {
            target: 'refPanel',
            id: 'tracker-ref',
            label: 'Issue',
            providerId: 'tracker',
            order: 500,
            formFactor: ['desktop'],
            claimsKeys: [],
            layout: 'single',
            regions: { body: { kind: 'remote', entry: ownerEntry } },
          },
        ],
        routes: [
          {
            id: 'tracker.issue-route',
            path: '/p/:projectId/x/tracker/issues/:issue',
            surface: 'tracker-issue',
            item: 'issue',
            order: 500,
          },
        ],
        extensionPoints: [
          {
            id: 'issue-summary',
            label: 'Issue summary',
            kind: 'remote',
            mode: 'stack',
            max: 2,
            mounts: [
              { surface: 'tracker-issue', region: 'header' },
              { surface: 'tracker-ref', region: 'header' },
            ],
          },
        ],
      },
    },
  }) as unknown as NodePluginRow

const registered: Disposable[] = []
const contributor = (pluginId: string, over: { entry?: string; when?: () => boolean } = {}) =>
  registered.push(
    extensionRegistry.register({
      id: `plugin:${pluginId}:summary`,
      pluginId,
      point: 'tracker:issue-summary',
      label: `${pluginId} summary`,
      order: 500,
      carrier: 'remote',
      entry: over.entry ?? 'summary',
      hash: HASH,
      ...(over.when ? { when: over.when } : {}),
    }),
  )

const contributorTrees = () => mounted.filter((tree) => tree.contribution.id.startsWith('plugin:'))

const drawProjectView = (initial: { projectId: string; item?: string }) => {
  const [projectId, setProjectId] = createSignal(initial.projectId)
  const [item, setItem] = createSignal(initial.item)
  const surface = projectSurfaceRegistry.get('tracker-issue')!
  const host = document.createElement('div')
  document.body.append(host)
  const qc = new QueryClient()
  registerQueryOwner(qc, null)
  const dispose = render(
    () =>
      createComponent(QueryClientProvider, {
        client: qc,
        get children() {
          return createComponent(surface.component, {
            get projectId() {
              return projectId()
            },
            get item() {
              return item()
            },
          })
        },
      }),
    host,
  )
  const view = {
    host,
    setProjectId,
    setItem,
    dispose: () => {
      views.splice(views.indexOf(view), 1)
      dispose()
      host.remove()
      qc.clear()
    },
  }
  views.push(view)
  return view
}
const views: { dispose: () => void }[] = []

// The layout, the pane wrapper and the panel are lazy. Loaded once up front, so a cold transform
// doesn't eat the first test's wait.
beforeAll(async () => {
  await Promise.all([import('../layouts'), import('../chrome/ChromeExtendedPane'), import('./PluginRefPanel')])
})

beforeEach(() => {
  mounted.length = 0
  disposed.length = 0
  setActiveNode('node-a')
  _seedPluginDistribution([['node-a', [ownerRow()]]], [`tracker ${HASH}`])
  syncChromeContributions()
  syncFrameContributions()
})

afterEach(() => {
  for (const view of views.splice(0)) view.dispose()
  for (const disposable of registered.splice(0).reverse()) disposable.dispose()
  _resetFrameContributions()
  _resetChromeContributions()
  _resetPluginDistribution()
  setActiveNode(null)
})

describe('a project detail view’s regions', () => {
  it('mounts a contributor above the owner’s view with the routed item and nothing of the owner’s', async () => {
    contributor('widgets')
    const view = drawProjectView({ projectId: 'p-1', item: 'ENG-1' })
    await vi.waitFor(() => expect(contributorTrees()).toHaveLength(1))
    expect(contributorTrees()[0]!.props()).toEqual({ projectId: 'p-1', item: 'ENG-1', surface: 'tracker-issue' })
    // The contributor's bridge is scoped to the owner's project, never to a task.
    expect(contributorTrees()[0]!.scope?.()).toEqual({ projectId: 'p-1' })
    // A sibling above the owner's tree, not a slot inside it.
    await vi.waitFor(() => expect(view.host.querySelector('[data-tree="tracker"]')).not.toBeNull())
    const header = view.host.querySelector('.detail-region[data-region="header"]')!
    expect(header.contains(view.host.querySelector('[data-tree="widgets"]'))).toBe(true)
    expect(header.contains(view.host.querySelector('[data-tree="tracker"]'))).toBe(false)
    expect(
      header.compareDocumentPosition(view.host.querySelector('[data-tree="tracker"]')!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
  })

  it('carries a new routed item to the same worker, and remounts for a new project', async () => {
    contributor('widgets')
    const view = drawProjectView({ projectId: 'p-1', item: 'ENG-1' })
    await vi.waitFor(() => expect(contributorTrees()).toHaveLength(1))
    view.setItem('ENG-2')
    expect(contributorTrees()).toHaveLength(1)
    expect(view.host.querySelector('[data-tree="widgets"]')!.textContent).toContain('"item":"ENG-2"')
    view.setProjectId('p-2')
    await vi.waitFor(() => expect(contributorTrees()).toHaveLength(2))
    expect(disposed).toContain('plugin:widgets:summary')
    expect(contributorTrees()[1]!.scope?.()).toEqual({ projectId: 'p-2' })
  })

  it('mounts nothing while the owner shows no item, and draws nothing when nobody contributes', async () => {
    contributor('widgets')
    const view = drawProjectView({ projectId: 'p-1' })
    await vi.waitFor(() => expect(view.host.querySelector('[data-tree="tracker"]')).not.toBeNull())
    expect(contributorTrees()).toHaveLength(0)
    expect(view.host.querySelector('.detail-region')).toBeNull()
    view.dispose()

    for (const disposable of registered.splice(0)) disposable.dispose()
    const empty = drawProjectView({ projectId: 'p-1', item: 'ENG-1' })
    await vi.waitFor(() => expect(empty.host.querySelector('[data-tree="tracker"]')).not.toBeNull())
    // The region is reserved but empty, which the stylesheet draws as nothing at all.
    expect(empty.host.querySelector('.detail-region')!.childElementCount).toBe(0)
    expect(empty.host.querySelector('.detail-region:empty')).not.toBeNull()
  })

  it('stacks up to the owner’s two and leaves out a disabled contributor', async () => {
    contributor('alpha')
    contributor('beta')
    contributor('gamma')
    contributor('off', { when: () => false })
    const view = drawProjectView({ projectId: 'p-1', item: 'ENG-1' })
    await vi.waitFor(() => expect(contributorTrees()).toHaveLength(2))
    expect(contributorTrees().map((tree) => tree.contribution.pluginId)).toEqual(['alpha', 'beta'])
    expect(view.host.textContent).toContain('1 more from other plugins')
  })

  it('keeps the owner’s view when a contributor fails, and the contributors when the owner fails', async () => {
    contributor('broken', { entry: 'broken' })
    contributor('widgets')
    const view = drawProjectView({ projectId: 'p-1', item: 'ENG-1' })
    await vi.waitFor(() => expect(view.host.querySelector('[data-tree="tracker"]')).not.toBeNull())
    expect(view.host.querySelector('[data-tree="widgets"]')).not.toBeNull()
    view.dispose()

    // The owner's tree fails. Its region stands empty and the header still draws its contributor.
    _seedPluginDistribution([['node-a', [ownerRow('broken')]]], [`tracker ${HASH}`])
    syncChromeContributions()
    syncFrameContributions()
    for (const disposable of registered.splice(0)) disposable.dispose()
    contributor('widgets')
    mounted.length = 0
    const failing = drawProjectView({ projectId: 'p-1', item: 'ENG-1' })
    await vi.waitFor(() => expect(mounted.some((tree) => tree.contribution.id === 'tracker-issue')).toBe(true))
    expect(failing.host.querySelector('[data-tree="widgets"]')).not.toBeNull()
  })
})

describe('a reference panel’s regions', () => {
  it('mounts with the panel’s own reference and no task or project', async () => {
    contributor('widgets')
    const panel = refPanelRegistry.get('tracker-ref')!
    const qc = new QueryClient()
    registerQueryOwner(qc, null)
    const dispose = render(
      () =>
        createComponent(QueryClientProvider, {
          client: qc,
          get children() {
            return createComponent(panel.component, {
              target: { providerId: 'tracker', displayId: 'ENG-7' },
              onClose: () => {},
            } as never)
          },
        }),
      document.createElement('div'),
    )
    await vi.waitFor(() => expect(contributorTrees()).toHaveLength(1))
    expect(contributorTrees()[0]!.props()).toEqual({ item: 'ENG-7', refId: 'ENG-7', surface: 'tracker-ref' })
    expect(contributorTrees()[0]!.scope?.()).toEqual({})
    dispose()
    qc.clear()
  })
})
