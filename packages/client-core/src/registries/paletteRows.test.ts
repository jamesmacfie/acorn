import { afterEach, describe, expect, it } from 'vitest'
import { paletteRowRegistry, paletteRowSources, type PaletteRowSource } from './paletteRows'

// `paletteRowSources()` sorts on the declared `order`, which is the whole reason the field exists: the palette's
// row order used to be fixed because `composeItems` built run, layout and workflow rows itself, and once the
// three moved into two plugins the only thing left holding the order was this sort. Nothing asserted it.

const source = (id: string, order: number): PaletteRowSource => ({
  id,
  order,
  rows: async () => ({ rows: [] }),
  invoke: async () => undefined,
})

describe('paletteRowSources', () => {
  const disposables: { dispose(): void }[] = []
  afterEach(() => {
    while (disposables.length) disposables.pop()!.dispose()
  })
  const add = (id: string, order: number) => void disposables.push(paletteRowRegistry.register(source(id, order)))

  it('sorts by declared order, not registration order', () => {
    // Registered in the WRONG order on purpose: 20 first, then 10. Terminal's run/layout rows are order 10 and
    // workflows' are 20, and the palette shows run → layout → workflow, so this is the user-visible sequence.
    add('workflows.defs', 20)
    add('terminal.run', 10)
    expect(paletteRowSources().map((s) => s.id)).toEqual(['terminal.run', 'workflows.defs'])
  })

  it('does not mutate the registry list while sorting it', () => {
    // `.slice()` before `.sort()` — without it the sort reorders the registry's own array in place, so a
    // registration made afterwards would land in a list already shuffled by a previous palette open.
    add('b', 2)
    add('a', 1)
    paletteRowSources()
    expect(paletteRowRegistry.entries().map((s) => s.id)).toEqual(['b', 'a'])
  })
})
