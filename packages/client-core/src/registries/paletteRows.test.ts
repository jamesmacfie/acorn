import { afterEach, describe, expect, it } from 'vitest'
import { paletteRowRegistry, paletteRowSources, type PaletteRowSource } from './paletteRows'

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
    // Registered out of declared order: 20 first, then 10. Terminal's run/layout rows are
    // order 10 and workflows' are 20, and the palette shows run, then layout, then workflow, so this
    // is the user-visible sequence.
    add('workflows.defs', 20)
    add('terminal.run', 10)
    expect(paletteRowSources().map((s) => s.id)).toEqual(['terminal.run', 'workflows.defs'])
  })

  it('does not mutate the registry list while sorting it', () => {
    // `.slice()` before `.sort()`. Without it, the sort reorders the registry's own array in place, so
    // a registration made afterwards would land in a list already shuffled by a previous palette
    // open.
    add('b', 2)
    add('a', 1)
    paletteRowSources()
    expect(paletteRowRegistry.entries().map((s) => s.id)).toEqual(['b', 'a'])
  })
})
