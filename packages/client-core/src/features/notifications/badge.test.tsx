import { afterEach, expect, it } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import { trackBadge } from './badge'

// A `.tsx` with no JSX in it, on purpose: the `logic` project resolves solid-js to its server build,
// where every effect renders once and dead, so a reactivity assertion has to run in `hosts`
// (vitest.config.ts).

const drawn: (number | null)[] = []
const install = (canDraw: boolean): void => {
  drawn.length = 0
  ;(window as { acorn?: unknown }).acorn = canDraw
    ? { notify: { show: async () => true, onActivate: () => () => {}, setBadge: (count: number | null) => drawn.push(count) } }
    : {}
}

afterEach(() => { delete (window as { acorn?: unknown }).acorn })

// The writes are outside the root because Solid flushes queued effects when `createRoot` returns,
// not part-way through its body.
it('draws the pill on the icon and clears it at zero', () => {
  install(true)
  const [pill, setPill] = createSignal(0)
  const dispose = createRoot((dispose) => { trackBadge(pill, () => true); return dispose })
  setPill(2)
  setPill(0)
  dispose()
  expect(drawn).toEqual([null, 2, null])
})

// Off untracks the pill, so the icon is cleared once rather than on every unread that follows.
it('clears the icon once when the switch is off', () => {
  install(true)
  const [pill, setPill] = createSignal(0)
  const dispose = createRoot((dispose) => { trackBadge(pill, () => false); return dispose })
  setPill(2)
  dispose()
  expect(drawn).toEqual([null])
})

it('does nothing where the host cannot draw one', () => {
  install(false)
  createRoot((dispose) => { trackBadge(() => 3, () => true); return dispose })()
  expect(drawn).toEqual([])
})
