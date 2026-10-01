import { expect, it } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import { resetPaneAfterRecovery } from './recovery'

it('retries a failed pane only after the node query refresh completes', async () => {
  let dispose = () => {}
  const [recovery, setRecovery] = createSignal(1)
  let resets = 0

  createRoot((stop) => {
    dispose = stop
    resetPaneAfterRecovery(recovery, () => { resets += 1 })
  })
  await Promise.resolve()
  expect(resets).toBe(0)

  setRecovery(2)
  await Promise.resolve()
  expect(resets).toBe(1)
  dispose()
})
