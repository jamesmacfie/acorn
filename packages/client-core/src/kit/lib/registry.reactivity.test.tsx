import { createEffect, createRoot, createSignal, onCleanup } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { Registry } from './registry'

// Registration is allowed inside a reactive owner: a surface can publish commands or menu actions
// whose roster follows the selected object. The mutation must not make that owner depend on the
// registry itself, or its own write and cleanup form an infinite loop.
describe('reactive registry ownership', () => {
  it('reruns for its source but not for its own registrations', async () => {
    const registry = new Registry<{ id: string }>('command')
    const [selected, setSelected] = createSignal('one')
    let runs = 0
    const dispose = createRoot((stop) => {
      createEffect(() => {
        const id = selected()
        runs++
        const registration = registry.register({ id })
        onCleanup(() => registration.dispose())
      })
      return stop
    })

    await Promise.resolve()
    expect(runs).toBe(1)
    expect(registry.entries().map((entry) => entry.id)).toEqual(['one'])

    setSelected('two')
    expect(runs).toBe(2)
    expect(registry.entries().map((entry) => entry.id)).toEqual(['two'])

    dispose()
    expect(registry.entries()).toEqual([])
  })
})
