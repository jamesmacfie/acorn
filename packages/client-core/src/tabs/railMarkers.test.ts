import { describe, expect, it } from 'vitest'
import {
  clampMarkerPriority,
  isValidRailMarker,
  resolveRailMarkers,
  type RailMarker,
} from './railMarkers'

const marker = (over: Partial<RailMarker> & { id: string }): RailMarker => ({
  label: `label for ${over.id}`,
  icon: 'pin',
  placements: ['top-start'],
  ...over,
})

const positions = (markers: RailMarker[]) =>
  Object.fromEntries(resolveRailMarkers(markers).placed.map((m) => [m.id, m.position]))

describe('resolveRailMarkers', () => {
  it('places nothing when there is nothing to say', () => {
    expect(resolveRailMarkers([])).toEqual({ placed: [], legend: [] })
  })

  it('places an icon marker and a dot marker', () => {
    const resolved = resolveRailMarkers([
      marker({ id: 'a' }),
      marker({ id: 'b', icon: undefined, dotTone: 'ok', placements: ['top-end'] }),
    ])
    expect(resolved.placed.map((m) => m.position)).toEqual(['top-start', 'top-end'])
    expect(resolved.legend).toEqual([
      { g: 'pin', d: undefined, t: undefined, l: 'label for a' },
      { g: undefined, d: 'ok', t: undefined, l: 'label for b' },
    ])
  })

  it('allocates the same way whatever order it is handed', () => {
    const a = marker({ id: 'a', priority: 10, placements: ['top-end', 'bottom-end'] })
    const b = marker({ id: 'b', priority: 10, placements: ['top-end', 'bottom-end'] })
    expect(positions([a, b])).toEqual(positions([b, a]))
    expect(positions([a, b])).toEqual({ a: 'top-end', b: 'bottom-end' })
  })

  it('sends the loser of a contested corner to its next choice', () => {
    expect(positions([
      marker({ id: 'high', priority: 200, placements: ['top-end'] }),
      marker({ id: 'low', priority: 100, placements: ['top-end', 'bottom-end'] }),
    ])).toEqual({ high: 'top-end', low: 'bottom-end' })
  })

  it('keeps a marker with no free position in the legend but off the control', () => {
    const resolved = resolveRailMarkers([
      marker({ id: 'winner', priority: 200, placements: ['top-end'] }),
      marker({ id: 'crowded-out', priority: 100, placements: ['top-end'] }),
    ])
    expect(resolved.placed.map((m) => m.id)).toEqual(['winner'])
    expect(resolved.legend.map((item) => item.l)).toEqual(['label for winner', 'label for crowded-out'])
  })

  it('lets a host state outrank the range plugin markers are clamped to', () => {
    expect(positions([
      marker({ id: 'plugin', priority: clampMarkerPriority(9999), placements: ['top-start', 'bottom-start'] }),
      marker({ id: 'core-pin', priority: 240, placements: ['top-start', 'bottom-start'] }),
    ])).toEqual({ 'core-pin': 'top-start', plugin: 'bottom-start' })
  })

  it('carries a marker-level busy flag without touching anything else', () => {
    const [placed] = resolveRailMarkers([marker({ id: 'working', busy: true, placements: ['bottom-center'] })]).placed
    expect(placed).toMatchObject({ busy: true, position: 'bottom-center' })
  })

  it('refuses a marker that has no meaning, no representation, or both representations', () => {
    expect(isValidRailMarker(marker({ id: 'a', label: '' }))).toBe(false)
    expect(isValidRailMarker(marker({ id: 'a', icon: undefined }))).toBe(false)
    expect(isValidRailMarker(marker({ id: 'a', dotTone: 'ok' }))).toBe(false)
    expect(isValidRailMarker(marker({ id: 'a', placements: [] }))).toBe(false)
    expect(isValidRailMarker(marker({ id: '', label: 'x' }))).toBe(false)
    // Dropped rather than thrown over: one bad contribution must not blank the rail.
    expect(resolveRailMarkers([marker({ id: 'a', label: '' }), marker({ id: 'b' })]).placed.map((m) => m.id)).toEqual(['b'])
  })
})

describe('clampMarkerPriority', () => {
  it('holds a contributed priority inside the public range', () => {
    expect(clampMarkerPriority(undefined)).toBe(0)
    expect(clampMarkerPriority(-5)).toBe(0)
    expect(clampMarkerPriority(50)).toBe(50)
    expect(clampMarkerPriority(500)).toBe(100)
    expect(clampMarkerPriority(Number.NaN)).toBe(0)
  })
})
