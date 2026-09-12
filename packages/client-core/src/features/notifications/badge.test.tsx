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
// not part-way through its body. Each case asserts before disposing, since disposal is itself a
// write now.
it('draws the pill on the icon and clears it at zero', () => {
  install(true)
  const [pill, setPill] = createSignal(0)
  const dispose = createRoot((dispose) => { trackBadge(pill, () => true); return dispose })
  setPill(2)
  setPill(0)
  expect(drawn).toEqual([null, 2, null])
  dispose()
})

// The icon keeps whatever it was last told, so the number has to come off when the scope that mirrors
// it ends. Otherwise a closed window or a rebuilt shell leaves a count nothing in the app can clear.
it('takes the number off the icon when the scope ends', () => {
  install(true)
  const [pill, setPill] = createSignal(0)
  const dispose = createRoot((dispose) => { trackBadge(pill, () => true); return dispose })
  setPill(3)
  expect(drawn.at(-1)).toBe(3)
  dispose()
  expect(drawn.at(-1)).toBe(null)
})

// Off untracks the pill, so the icon is cleared once rather than on every unread that follows.
it('clears the icon once when the switch is off', () => {
  install(true)
  const [pill, setPill] = createSignal(0)
  const dispose = createRoot((dispose) => { trackBadge(pill, () => false); return dispose })
  setPill(2)
  expect(drawn).toEqual([null])
  dispose()
})

it('does nothing where the host cannot draw one', () => {
  install(false)
  createRoot((dispose) => { trackBadge(() => 3, () => true); return dispose })()
  expect(drawn).toEqual([])
})
