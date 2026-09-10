import { describe, expect, it } from 'vitest'
import { Registry } from './registry'

type Entry = { id: string }

describe('Registry', () => {
  it('refuses a duplicate id', () => {
    const registry = new Registry<Entry>('pane')
    registry.register({ id: 'changes' })
    expect(() => registry.register({ id: 'changes' })).toThrow('pane contribution already registered: changes')
  })

  it('drops an entry when its registration is disposed', () => {
    const registry = new Registry<Entry>('pane')
    const disposable = registry.register({ id: 'changes' })
    expect(registry.get('changes')).toBeDefined()
    disposable.dispose()
    expect(registry.get('changes')).toBeUndefined()
  })
})

describe('the owner side-map', () => {
  it('answers with the plugin that registered the entry', () => {
    const registry = new Registry<Entry>('pane')
    registry.register({ id: 'terminal' }, 'terminal')
    expect(registry.ownerOf('terminal')).toBe('terminal')
  })

  it('answers undefined for core, which registers without one', () => {
    // Undefined rather than `'core'`. The seams that read this stamp `core` themselves, and a
    // registry that answered `core` for an id nobody has registered would be indistinguishable
    // from one that answered for a real core contribution.
    const registry = new Registry<Entry>('pane')
    registry.register({ id: 'changes' })
    expect(registry.ownerOf('changes')).toBeUndefined()
    expect(registry.ownerOf('never-registered')).toBeUndefined()
  })

  it('forgets the owner when the entry goes', () => {
    // A reloaded plugin registers again, and a stale owner left behind would answer for whoever
    // takes the id next.
    const registry = new Registry<Entry>('pane')
    const disposable = registry.register({ id: 'notes' }, 'notes')
    disposable.dispose()
    expect(registry.ownerOf('notes')).toBeUndefined()
  })
})
