import { afterEach, describe, expect, it } from 'vitest'
import { _resetSurfaceHealth, registerSurfaceHealth, type SurfaceHealthSnapshot } from '../../kit/lib/telemetry/surfaceHealth'
import { answerSurfaceHealthRequests, SURFACE_HEALTH_MARK, SURFACE_HEALTH_REQUEST } from './surfaceHealth'

afterEach(() => {
  _resetSurfaceHealth()
  performance.clearMarks(SURFACE_HEALTH_MARK)
})

describe('answering a health request', () => {
  it('writes the current snapshot as the one health mark, synchronously', () => {
    const target = new EventTarget()
    const stop = answerSurfaceHealthRequests(target)
    let rows = 1
    registerSurfaceHealth('diff', () => ({ mounted: { fixedRows: rows } }))

    for (rows = 1; rows <= 50; rows += 1) target.dispatchEvent(new Event(SURFACE_HEALTH_REQUEST))

    // Asked fifty times, one entry: a long flow cannot grow the performance timeline.
    const marks = performance.getEntriesByName(SURFACE_HEALTH_MARK)
    expect(marks).toHaveLength(1)
    const detail = (marks[0] as PerformanceMark).detail as SurfaceHealthSnapshot
    expect(detail.surfaces[0]?.mounted.fixedRows).toBe(50)

    stop()
    target.dispatchEvent(new Event(SURFACE_HEALTH_REQUEST))
    expect(((performance.getEntriesByName(SURFACE_HEALTH_MARK)[0] as PerformanceMark).detail as SurfaceHealthSnapshot).surfaces[0]?.mounted.fixedRows).toBe(50)
  })
})
