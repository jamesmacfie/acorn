import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/solid-query'
import { prefsKey } from '@acorn/protocol/api.ts'
import { sourceRegistry } from '../../host/registries/sources/sources'
import { commandRegistry } from '../../host/registries/commands/commands'
import { PrefKeys } from '../../infra/persistence/prefKeys'
import { selectedSource, setSelectedSource } from '../tasks/tasks'
import { hiddenSourcesToOpen, parseRailVisibility, pluginOpenerId, pluginSources, railVisibilityKey, setShownInRail, shownInRail } from './railVisibility'

// Presentation over availability (./railVisibility.ts): the user's switch beats the source's default,
// core's own sources are never hideable, and hiding the source on screen is the one thing that
// changes the selection.
describe('rail visibility', () => {
  const disposables: { dispose(): void }[] = []
  beforeAll(() => {
    disposables.push(
      sourceRegistry.register({ id: 'home', order: 0, glyph: 'house', label: 'Home', isDefault: true }),
      sourceRegistry.register({ id: 'board', order: 50, glyph: 'kanban', label: 'Board', showInRailByDefault: false }, 'board-plugin'),
      sourceRegistry.register({ id: 'docker', order: 40, glyph: 'box', label: 'Docker' }, 'docker'),
    )
  })
  afterAll(() => disposables.forEach((disposable) => disposable.dispose()))

  it('reads a source’s default until the user chooses, then the choice', () => {
    expect(shownInRail('board', {})).toBe(false)
    expect(shownInRail('docker', {})).toBe(true)
    expect(shownInRail('board', { [railVisibilityKey('board-plugin', 'board')]: true })).toBe(true)
    expect(shownInRail('docker', { [railVisibilityKey('docker', 'docker')]: false })).toBe(false)
  })

  it('never hides a core source, whatever the preference says', () => {
    expect(shownInRail('home', { 'core:home': false, ':home': false })).toBe(true)
  })

  it('keeps only boolean entries and survives a corrupt value', () => {
    expect(parseRailVisibility('{"a:b":false,"c:d":"no","e:f":true}')).toEqual({ 'a:b': false, 'e:f': true })
    expect(parseRailVisibility('[true]')).toEqual({})
    expect(parseRailVisibility('{')).toEqual({})
    expect(parseRailVisibility(undefined)).toEqual({})
  })

  it('lists plugin sources in rail order and leaves core’s out', () => {
    expect(pluginSources().map((row) => `${row.pluginId}/${row.source.id}`)).toEqual(['docker/docker', 'board-plugin/board'])
    expect(pluginSources('board-plugin').map((row) => row.source.id)).toEqual(['board'])
  })

  it('offers a palette opener for a hidden source unless its plugin already has one', () => {
    const entries = [{ id: 'board', glyph: 'kanban', label: 'Board' }, { id: 'docker', glyph: 'box', label: 'Docker' }]
    const hideDocker = JSON.stringify({ [railVisibilityKey('docker', 'docker')]: false })
    expect(hiddenSourcesToOpen(entries, hideDocker).map((source) => source.id)).toEqual(['board', 'docker'])
    const own = commandRegistry.register({ id: pluginOpenerId('docker'), title: 'Open Docker', category: 'navigation', run: () => {} })
    expect(hiddenSourcesToOpen(entries, hideDocker).map((source) => source.id)).toEqual(['board'])
    own.dispose()
  })

  it('goes Home when the source on screen is hidden, and stays put otherwise', async () => {
    const qc = new QueryClient()
    setSelectedSource('docker')
    await setShownInRail(qc, 'board-plugin', 'board', false)
    expect(selectedSource()).toBe('docker')
    await setShownInRail(qc, 'docker', 'docker', false)
    expect(selectedSource()).toBe('home')
    expect(parseRailVisibility(qc.getQueryData<Record<string, string>>(prefsKey)?.[PrefKeys.railVisibility]))
      .toEqual({ [railVisibilityKey('docker', 'docker')]: false })
  })
})
