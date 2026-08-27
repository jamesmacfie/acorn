import { describe, expect, it } from 'vitest'
import { createSignal } from 'solid-js'
import { markersFor, railMarkerRegistry, type RailMarkerContribution } from './railMarkers'
import { resolveRailMarkers, type RailMarker } from '../tabs/railMarkers'
import { initClientPlugins } from './plugin'

const running: RailMarker = { id: 'running', label: '2 running containers', icon: 'brand:docker', placements: ['top-start'] }

const contribution = (over: Partial<RailMarkerContribution> & { id: string }): RailMarkerContribution => ({
  order: 10,
  markers: () => [running],
  ...over,
})

const register = (entry: RailMarkerContribution) => {
  const disposable = railMarkerRegistry.register(entry)
  return disposable
}

describe('markersFor', () => {
  it('qualifies every marker id by the contribution that published it', () => {
    const disposable = register(contribution({ id: 'docker' }))
    expect(markersFor({ kind: 'task', id: 't1' }).map((m) => m.id)).toEqual(['docker:running'])
    disposable.dispose()
  })

  it('clamps a contributed priority into the public range', () => {
    const disposable = register(contribution({ id: 'greedy', markers: () => [{ ...running, priority: 9999 }] }))
    expect(markersFor({ kind: 'task', id: 't1' })[0]!.priority).toBe(100)
    disposable.dispose()
  })

  it('reads the contribution at call time, not at registration', () => {
    const [count, setCount] = createSignal(0)
    const disposable = register(contribution({
      id: 'live',
      markers: () => count() ? [{ ...running, label: `${count()} running` }] : [],
    }))
    expect(markersFor({ kind: 'task', id: 't1' })).toEqual([])
    setCount(3)
    expect(markersFor({ kind: 'task', id: 't1' })[0]!.label).toBe('3 running')
    disposable.dispose()
  })

  it('passes the target through, so a contribution can answer per task, source, or pane', () => {
    const seen: string[] = []
    const disposable = register(contribution({
      id: 'nosy',
      markers: (target) => { seen.push(`${target.kind}:${target.id}`); return [] },
    }))
    markersFor({ kind: 'task', id: 't1' })
    markersFor({ kind: 'source', id: 'docker' })
    markersFor({ kind: 'pane', id: 'containers', taskId: 't1' })
    expect(seen).toEqual(['task:t1', 'source:docker', 'pane:containers'])
    disposable.dispose()
  })

  it('isolates a throwing contribution instead of blanking the control', () => {
    const bad = register(contribution({ id: 'bad', order: 1, markers: () => { throw new Error('boom') } }))
    const good = register(contribution({ id: 'good', order: 2 }))
    expect(markersFor({ kind: 'task', id: 't1' }).map((m) => m.id)).toEqual(['good:running'])
    bad.dispose()
    good.dispose()
  })
})

describe('plugin ownership', () => {
  const plugin = { name: 'docker', init: (ctx: { railMarkers: { register(entry: RailMarkerContribution): void } }) => ctx.railMarkers.register(contribution({ id: 'docker' })) }

  it('replaces a plugin’s markers on reactivation rather than duplicating them', () => {
    initClientPlugins([plugin])
    initClientPlugins([plugin])
    expect(markersFor({ kind: 'task', id: 't1' }).map((m) => m.id)).toEqual(['docker:running'])
    initClientPlugins([plugin], { disabled: ['docker'] })
  })

  it('takes a disabled plugin’s markers back out', () => {
    initClientPlugins([plugin])
    initClientPlugins([plugin], { disabled: ['docker'] })
    expect(markersFor({ kind: 'task', id: 't1' })).toEqual([])
  })
})

describe('the two feeders together', () => {
  it('gives a pinned task with running containers two distinct corners', () => {
    const disposable = register(contribution({ id: 'docker', markers: () => [{ ...running, placements: ['top-start', 'bottom-start'] }] }))
    const core: RailMarker = { id: 'pinned', label: 'Pinned to top', icon: 'pin', placements: ['top-start', 'bottom-start'], priority: 240 }
    const placed = resolveRailMarkers([core, ...markersFor({ kind: 'task', id: 't1' })]).placed
    expect(placed.map((m) => [m.id, m.position])).toEqual([['pinned', 'top-start'], ['docker:running', 'bottom-start']])
    disposable.dispose()
  })
})
