import { describe, expect, it, vi } from 'vitest'
import { createRoot, createSignal } from 'solid-js'
import { commandRegistry } from '../../host/registries/commands/commands'
import { keybindingRegistry, resolveKeybindings } from '../../host/registries/commands/keybindings'
import type { SourceEntry } from './railSources'
import { registerSourceOpeners } from './sourceOpeners'

// One row per source the host can open, drawn or hidden, with the hint only where the rail isn't
// drawing it, and a shortcut that starts unbound and follows the row in and out.
describe('source openers', () => {
  const home: SourceEntry = { id: 'home', glyph: 'house', label: 'Home' }
  const docker: SourceEntry = { id: 'docker', glyph: 'box', label: 'Docker' }
  const openers = () =>
    commandRegistry
      .entries()
      .filter((command) => command.id.startsWith('source.'))
      .map((command) => ({ id: command.id, title: command.title, hint: command.hint }))

  it('lists drawn and hidden sources, and leaves with them', () => {
    const open = vi.fn()
    const [sources, setSources] = createSignal([home, docker])
    const dispose = createRoot((dispose) => {
      registerSourceOpeners({ sources, open, hidden: (id) => id === 'docker', shortcuts: true })
      return dispose
    })

    expect(openers()).toEqual([
      { id: 'source.home.open', title: 'Open Home', hint: undefined },
      { id: 'source.docker.open', title: 'Open Docker', hint: 'hidden from the left rail' },
    ])
    const shortcuts = resolveKeybindings(keybindingRegistry.entries()).filter((binding) => binding.category === 'Rail')
    expect(shortcuts.map((binding) => [binding.id, binding.chord])).toEqual([
      ['source.home.open', null],
      ['source.docker.open', null],
    ])
    expect(
      resolveKeybindings(keybindingRegistry.entries(), { keybindings: '{"source.docker.open":"meta+d"}' }).find(
        (binding) => binding.id === 'source.docker.open',
      )?.chord,
    ).toBe('meta+d')

    const command = commandRegistry.get('source.docker.open') as { run: (context: unknown) => void }
    command.run({ projectId: null })
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: 'docker' }), { projectId: null })

    setSources([home])
    expect(openers().map((row) => row.id)).toEqual(['source.home.open'])
    expect(keybindingRegistry.get('source.docker.open')).toBeUndefined()

    dispose()
    expect(openers()).toEqual([])
    expect(keybindingRegistry.get('source.home.open')).toBeUndefined()
  })

  it('registers no shortcuts for a host that keeps its own keymap', () => {
    const dispose = createRoot((dispose) => {
      registerSourceOpeners({ sources: () => [docker], open: () => {} })
      return dispose
    })
    expect(openers()).toEqual([{ id: 'source.docker.open', title: 'Open Docker', hint: undefined }])
    expect(keybindingRegistry.get('source.docker.open')).toBeUndefined()
    dispose()
  })
})
