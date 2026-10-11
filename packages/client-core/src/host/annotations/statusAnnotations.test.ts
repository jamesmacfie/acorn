import { createSignal } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CORE_PANE_POINT,
  CORE_SOURCE_POINT,
  type PluginAnnotationKey,
  type PluginAnnotationMark,
} from '@acorn/protocol/extensionPoints.ts'
import { clearAnnotations } from './annotations'
import {
  extensionPointRegistry,
  extensionRegistry,
  type ExtensionContribution,
} from '../registries/extensionPoints/extensionPoints'
import { markersFor, railMarkerRegistry } from '../registries/rail/railMarkerFeed'
import { sourceRegistry, type SourceContribution } from '../registries/sources/sources'
import { resolveRailMarkers } from '../../features/tabs/railMarkers'
import type { Disposable } from '../../kit/lib/state/registry'
import { releasePaneAnnotations, requestPaneAnnotations, requestSourceAnnotations } from './statusAnnotations'

vi.mock('../plugins/surfaceFailures', () => ({ recordSurfaceFailure: vi.fn() }))

// `core:source` and `core:pane` are `core:task` with the owner's consent added. What is worth pinning
// is who gets asked, what each mark is keyed by, and when marks go away: a mark is only ever drawn for
// a key this host asked about, from the owner registration and Node it asked under.

const registered: Disposable[] = []
const keep = (disposable: Disposable): Disposable => {
  registered.push(disposable)
  return disposable
}

type Answer = (keys: PluginAnnotationKey[]) => PluginAnnotationMark[] | Promise<PluginAnnotationMark[]>

const contributor = (pluginId: string, point: string, answer: Answer, requestScope?: () => string) => {
  const marks = vi.fn(async (keys: PluginAnnotationKey[]) => answer(keys))
  const registration = keep(
    extensionRegistry.register({
      id: `plugin:${pluginId}:status`,
      pluginId,
      point,
      label: `${pluginId} status`,
      order: 500,
      carrier: 'items',
      marks,
      ...(requestScope ? { requestScope } : {}),
    } as ExtensionContribution),
  )
  return { marks, registration }
}

const source = (over: Partial<SourceContribution> & { id: string }) =>
  keep(sourceRegistry.register({ order: 10, glyph: 'box', label: over.id, ...over }))

const mark = (
  key: PluginAnnotationKey,
  text: string,
  severity: PluginAnnotationMark['severity'] = 'warn',
): PluginAnnotationMark => ({ key, severity, text })

const labels = (target: Parameters<typeof markersFor>[0]) => markersFor(target).map((marker) => marker.label)

afterEach(() => {
  requestSourceAnnotations([], null)
  for (const id of ['t1', 't2']) releasePaneAnnotations(id)
  for (const disposable of registered.splice(0).reverse()) disposable.dispose()
  clearAnnotations()
})

describe('core:source', () => {
  it('is declared by core, keyed by source and project', () => {
    expect(extensionPointRegistry.get(CORE_SOURCE_POINT)).toMatchObject({
      ownerId: 'core',
      kind: 'annotation',
      key: ['sourceId', 'projectId'],
    })
  })

  it('asks only about consenting sources, keyed by the routed project or by no project', async () => {
    source({ id: 'git', projectScoped: true, statusAnnotations: true })
    source({ id: 'docker', statusAnnotations: true })
    source({ id: 'home' })
    const { marks } = contributor('deploys', CORE_SOURCE_POINT, () => [
      mark({ sourceId: 'git', projectId: 'p1' }, 'Main is red'),
      mark({ sourceId: 'docker', projectId: '' }, 'Two containers down', 'danger'),
      // Neither was asked about: a source that did not consent, and a project not routed.
      mark({ sourceId: 'home', projectId: '' }, 'Smuggled'),
      mark({ sourceId: 'git', projectId: 'p2' }, 'Another project'),
    ])

    requestSourceAnnotations(['git', 'docker', 'home', 'git'], 'p1')
    await vi.waitFor(() => expect(labels({ kind: 'source', id: 'git' })).toEqual(['Main is red — deploys']))

    expect(marks).toHaveBeenCalledOnce()
    expect(marks.mock.calls[0]![0]).toEqual([
      { sourceId: 'git', projectId: 'p1' },
      { sourceId: 'docker', projectId: '' },
    ])
    expect(labels({ kind: 'source', id: 'docker' })).toEqual(['Two containers down — deploys'])
    expect(labels({ kind: 'source', id: 'home' })).toEqual([])
    // A source mark says nothing about a task or a pane with the same id.
    expect(markersFor({ kind: 'task', id: 'git' })).toEqual([])
    expect(markersFor({ kind: 'pane', id: 'git', taskId: 't1' })).toEqual([])
  })

  it('asks about nothing when no source consented, and skips a project-scoped one with no project', () => {
    source({ id: 'git', projectScoped: true, statusAnnotations: true })
    source({ id: 'home' })
    const { marks } = contributor('deploys', CORE_SOURCE_POINT, () => [])
    requestSourceAnnotations(['git', 'home'], null)
    requestSourceAnnotations(['git', 'home'], '')
    expect(marks).not.toHaveBeenCalled()
  })

  it('clears at once on a routed-project change and drops the old project’s late answer', async () => {
    source({ id: 'git', projectScoped: true, statusAnnotations: true })
    const pending = new Map<string, (marks: PluginAnnotationMark[]) => void>()
    contributor(
      'deploys',
      CORE_SOURCE_POINT,
      (keys) =>
        new Promise((resolve) => {
          pending.set(String(keys[0]!.projectId), resolve)
        }),
    )

    requestSourceAnnotations(['git'], 'p1')
    requestSourceAnnotations(['git'], 'p2')
    pending.get('p1')!([mark({ sourceId: 'git', projectId: 'p1' }, 'Old project')])
    pending.get('p2')!([mark({ sourceId: 'git', projectId: 'p2' }, 'New project')])

    await vi.waitFor(() => expect(labels({ kind: 'source', id: 'git' })).toEqual(['New project — deploys']))
    requestSourceAnnotations(['git'], 'p1')
    expect(labels({ kind: 'source', id: 'git' })).toEqual([])
  })

  it('drops marks when the owner is hidden or its registration is replaced', async () => {
    let owner = source({ id: 'docker', statusAnnotations: true })
    const { marks } = contributor('deploys', CORE_SOURCE_POINT, () => [
      mark({ sourceId: 'docker', projectId: '' }, 'Down'),
    ])
    requestSourceAnnotations(['docker'], 'p1')
    await vi.waitFor(() => expect(labels({ kind: 'source', id: 'docker' })).toHaveLength(1))

    // A plugin reload re-registers the same id. The old registration's marks go before the new ask.
    owner.dispose()
    owner = source({ id: 'docker', statusAnnotations: true })
    requestSourceAnnotations(['docker'], 'p1')
    expect(labels({ kind: 'source', id: 'docker' })).toEqual([])
    expect(marks).toHaveBeenCalledTimes(2)
    await vi.waitFor(() => expect(labels({ kind: 'source', id: 'docker' })).toHaveLength(1))

    // Disabled or untrusted, the source is no longer drawn, so it is no longer asked about.
    requestSourceAnnotations([], 'p1')
    expect(labels({ kind: 'source', id: 'docker' })).toEqual([])
  })

  it('keeps the same source on two Nodes apart', async () => {
    source({ id: 'docker', statusAnnotations: true })
    const [node, setNode] = createSignal('node-a')
    const pending: ((marks: PluginAnnotationMark[]) => void)[] = []
    contributor(
      'deploys',
      CORE_SOURCE_POINT,
      () =>
        new Promise((resolve) => {
          pending.push(resolve)
        }),
      node,
    )

    requestSourceAnnotations(['docker'], 'p1')
    setNode('node-b')
    requestSourceAnnotations(['docker'], 'p1')
    pending[0]!([mark({ sourceId: 'docker', projectId: '' }, 'Node A says down')])
    pending[1]!([mark({ sourceId: 'docker', projectId: '' }, 'Node B says up', 'info')])

    await vi.waitFor(() => expect(labels({ kind: 'source', id: 'docker' })).toEqual(['Node B says up — deploys']))
  })
})

describe('core:pane', () => {
  const pane = (id: string, statusAnnotations = true) => ({ id, statusAnnotations })

  it('is declared by core, keyed by pane and task', () => {
    expect(extensionPointRegistry.get(CORE_PANE_POINT)).toMatchObject({
      ownerId: 'core',
      kind: 'annotation',
      key: ['paneId', 'taskId'],
    })
  })

  it('sends one batch per contributor however many buttons consent', async () => {
    const panes = Array.from({ length: 60 }, (_, index) => pane(`pane-${index}`))
    const review = contributor('review', CORE_PANE_POINT, (keys) =>
      keys.map((key) => mark(key, `Reviewed ${key.paneId}`)),
    )
    const lint = contributor('lint', CORE_PANE_POINT, () => [
      mark({ paneId: 'pane-0', taskId: 't1' }, 'Lint failed', 'danger'),
    ])

    requestPaneAnnotations('t1', [...panes, pane('notes', false)])
    // The switcher's effect runs again on every unrelated redraw; an unchanged set asks nothing new.
    requestPaneAnnotations('t1', [...panes, pane('notes', false)])
    await vi.waitFor(() => expect(labels({ kind: 'pane', id: 'pane-0', taskId: 't1' })).toHaveLength(2))

    expect(review.marks).toHaveBeenCalledOnce()
    expect(lint.marks).toHaveBeenCalledOnce()
    expect(review.marks.mock.calls[0]![0]).toHaveLength(60)
    expect(review.marks.mock.calls[0]![0]).not.toContainEqual({ paneId: 'notes', taskId: 't1' })
    expect(labels({ kind: 'pane', id: 'pane-59', taskId: 't1' })).toEqual(['Reviewed pane-59 — review'])
    // Another task's switcher did not ask, so the same pane there draws nothing.
    expect(labels({ kind: 'pane', id: 'pane-0', taskId: 't2' })).toEqual([])
  })

  it('places four marks, keeps every label in the legend, and merges with owner markers in a fixed order', async () => {
    keep(
      railMarkerRegistry.register({
        id: 'changes',
        order: 20,
        markers: (target) =>
          target.kind === 'pane'
            ? [{ id: 'lines', label: 'Uncommitted changes', dotTone: 'ok', placements: ['top-end'] }]
            : [],
      }),
    )
    contributor('review', CORE_PANE_POINT, () =>
      Array.from({ length: 6 }, (_, index) => mark({ paneId: 'changes', taskId: 't1' }, `Finding ${index + 1}`)),
    )

    requestPaneAnnotations('t1', [pane('changes')])
    await vi.waitFor(() => expect(markersFor({ kind: 'pane', id: 'changes', taskId: 't1' })).toHaveLength(7))

    const resolved = resolveRailMarkers(markersFor({ kind: 'pane', id: 'changes', taskId: 't1' }))
    expect(resolved.placed).toHaveLength(4)
    expect(resolved.legend.map((item) => item.l)).toEqual([
      'Uncommitted changes',
      ...Array.from({ length: 6 }, (_, index) => `Finding ${index + 1} — review`),
    ])
    // The owner's own marker keeps the corner it asked for.
    expect(resolved.placed.find((marker) => marker.label === 'Uncommitted changes')?.position).toBe('top-end')
  })

  it('drops a closed task’s marks and its late answer, but not another task’s', async () => {
    let answer!: (marks: PluginAnnotationMark[]) => void
    const { marks } = contributor(
      'review',
      CORE_PANE_POINT,
      () =>
        new Promise((resolve) => {
          answer = resolve
        }),
    )

    requestPaneAnnotations('t1', [pane('changes')])
    releasePaneAnnotations('t1')
    answer([mark({ paneId: 'changes', taskId: 't1' }, 'Too late')])
    await Promise.resolve()
    expect(labels({ kind: 'pane', id: 'changes', taskId: 't1' })).toEqual([])

    requestPaneAnnotations('t2', [pane('changes')])
    answer([mark({ paneId: 'changes', taskId: 't2' }, 'Current')])
    await vi.waitFor(() => expect(labels({ kind: 'pane', id: 'changes', taskId: 't2' })).toHaveLength(1))
    // The first task's host unmounting after the second asked leaves the second's marks alone.
    releasePaneAnnotations('t1')
    expect(labels({ kind: 'pane', id: 'changes', taskId: 't2' })).toEqual(['Current — review'])
    expect(marks).toHaveBeenCalledTimes(2)
  })

  it('asks a reloaded contributor again and forgets the old one', async () => {
    const first = contributor('review', CORE_PANE_POINT, () => [
      mark({ paneId: 'changes', taskId: 't1' }, 'First build'),
    ])
    requestPaneAnnotations('t1', [pane('changes')])
    await vi.waitFor(() =>
      expect(labels({ kind: 'pane', id: 'changes', taskId: 't1' })).toEqual(['First build — review']),
    )

    first.registration.dispose()
    const second = contributor('review', CORE_PANE_POINT, () => [
      mark({ paneId: 'changes', taskId: 't1' }, 'Second build'),
    ])
    requestPaneAnnotations('t1', [pane('changes')])
    await vi.waitFor(() =>
      expect(labels({ kind: 'pane', id: 'changes', taskId: 't1' })).toEqual(['Second build — review']),
    )
    expect(second.marks).toHaveBeenCalledOnce()
  })
})
