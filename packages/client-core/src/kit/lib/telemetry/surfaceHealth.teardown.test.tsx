import { afterEach, expect, it } from 'vitest'
import { createComputed, createMemo, createRoot, createSignal, onCleanup } from 'solid-js'
import { _resetSurfaceHealth, registerSurfaceHealth, surfaceHealthSnapshot } from './surfaceHealth'

afterEach(() => _resetSurfaceHealth())

// A `.tsx` file only because Solid's live reactive build loads in the jsdom project; the `.ts` project
// gets the server build, where a memo never re-runs.
//
// The shape of a node switch from the agent transcript: the update that marks a parent stale also
// tears down a surface under it, and the surface's reader reads that parent. Read mid-teardown, the
// stale parent re-runs inside its own disposal, which in the app ends with Solid throwing on the
// half-cleared owner. Here the extra run is what shows it.
it('takes the final reading after the teardown, so a reader of a stale parent cannot re-run it', async () => {
  const [key, setKey] = createSignal(1)
  let runs = 0
  const disposeRoot = createRoot((dispose) => {
    const view: () => number = createMemo(() => {
      runs += 1
      const value = key()
      createComputed(() => {
        const probe = registerSurfaceHealth('timeline', () => ({ mounted: { dynamicBlocks: view() } }))
        onCleanup(probe.dispose)
      })
      return value
    })
    view()
    return dispose
  })

  expect(() => setKey(2)).not.toThrow()
  expect(runs).toBe(2)
  await Promise.resolve()
  const snapshot = surfaceHealthSnapshot()
  expect(snapshot.surfaces).toHaveLength(1)
  expect(snapshot.retired.timeline).toBeDefined()
  disposeRoot()
})
