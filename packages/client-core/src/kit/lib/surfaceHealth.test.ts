import { afterEach, describe, expect, it } from 'vitest'
import {
  _resetSurfaceHealth,
  registerSurfaceHealth,
  sanitizeSurfaceHealth,
  setSurfaceHealthHandler,
  surfaceHealthSnapshot,
  type SurfaceHealthEntry,
  type SurfaceHealthReading,
} from './surfaceHealth'

afterEach(() => _resetSurfaceHealth())

describe('the surface health registry', () => {
  it('reads a registered surface on demand and forgets it on dispose', () => {
    let rows = 3
    const probe = registerSurfaceHealth('diff', () => ({ mounted: { fixedRows: rows } }))
    expect(surfaceHealthSnapshot().surfaces).toHaveLength(1)
    expect(surfaceHealthSnapshot().surfaces[0]?.mounted.fixedRows).toBe(3)
    rows = 7
    expect(surfaceHealthSnapshot().surfaces[0]?.mounted.fixedRows).toBe(7)
    probe.dispose()
    expect(surfaceHealthSnapshot().surfaces).toEqual([])
  })

  it('keeps two mounted surfaces apart', () => {
    registerSurfaceHealth('diff', () => ({ mounted: { fixedRows: 10 } }))
    registerSurfaceHealth('diff', () => ({ mounted: { fixedRows: 20 } }))
    registerSurfaceHealth('timeline', () => ({ mounted: { dynamicBlocks: 5 } }))
    const { surfaces } = surfaceHealthSnapshot()
    expect(surfaces.map((entry) => [entry.kind, entry.mounted.fixedRows, entry.mounted.dynamicBlocks])).toEqual([
      ['diff', 10, 0],
      ['diff', 20, 0],
      ['timeline', 0, 5],
    ])
  })

  it('keeps the final reading of a disposed surface as retired, and nothing else from it', () => {
    let observers = 2
    const probe = registerSurfaceHealth('timeline', () => ({ measurement: { activeObservers: observers } }))
    // The owner's cleanups run before the registration's, so the final reading sees them done.
    observers = 0
    probe.dispose()
    probe.dispose()
    const snapshot = surfaceHealthSnapshot()
    expect(snapshot.surfaces).toEqual([])
    expect(snapshot.retired.timeline?.measurement.activeObservers).toBe(0)
    expect(snapshot.retired.diff).toBeUndefined()
  })

  it('reports checkpoints and teardown to the installed handler, and survives one that throws', () => {
    const seen: [string, string][] = []
    setSurfaceHealthHandler((entry, checkpoint) => {
      seen.push([entry.kind, checkpoint])
      throw new Error('handler failed')
    })
    const probe = registerSurfaceHealth('diff', () => ({ topology: { ready: true } }))
    probe.checkpoint('ready')
    probe.dispose()
    probe.checkpoint('ready')
    expect(seen).toEqual([['diff', 'ready'], ['diff', 'teardown']])
  })

  it('reads a surface whose reader throws as empty rather than failing the snapshot', () => {
    registerSurfaceHealth('diff', () => { throw new Error('reader failed') })
    const [entry] = surfaceHealthSnapshot().surfaces
    expect(entry?.mounted.fixedRows).toBe(0)
    expect(entry?.topology.ready).toBe(false)
  })
})

// The rule is structural: whatever a reader hands back, only the template's numeric fields survive.
describe('privacy', () => {
  const CANARY = 'CANARY-src/secret/path.ts-body-text-session-1234'

  it('drops strings, objects, and unknown fields from a reading', () => {
    const hostile = {
      topology: { files: CANARY, fixedRows: 4, ready: CANARY, path: CANARY },
      mounted: { fixedRows: { path: CANARY } },
      extra: { anything: CANARY },
    } as unknown as SurfaceHealthReading
    const entry = sanitizeSurfaceHealth('diff', hostile)
    expect(entry.topology.fixedRows).toBe(4)
    expect(entry.topology.files).toBe(0)
    expect(entry.topology.ready).toBe(false)
    expect(JSON.stringify(entry)).not.toContain('CANARY')
    expect(Object.keys(entry)).toEqual(['kind', 'topology', 'mounted', 'work', 'measurement', 'correction', 'resident', 'window'])
  })

  it('serializes to numbers, booleans, and the fixed kind labels only', () => {
    registerSurfaceHealth('diff', () => ({ topology: { ready: true, files: 3 }, work: { prepareMs: 1.23456 } }))
    registerSurfaceHealth('timeline', () => ({}))
    const snapshot = surfaceHealthSnapshot()
    const leaves: unknown[] = []
    const walk = (value: unknown) => {
      if (value && typeof value === 'object') Object.values(value).forEach(walk)
      else leaves.push(value)
    }
    walk(snapshot)
    for (const leaf of leaves) {
      expect(typeof leaf === 'number' || typeof leaf === 'boolean' || leaf === 'diff' || leaf === 'timeline').toBe(true)
    }
    expect((snapshot.surfaces[0] as SurfaceHealthEntry).work.prepareMs).toBe(1.23)
  })
})
