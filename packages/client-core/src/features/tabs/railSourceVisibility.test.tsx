import { createRoot, createSignal, type Accessor, type Setter } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Disposable } from '../../kit/lib/state/registry'

// Show in left rail is a presentation choice, not an availability gate (docs/frontend.md § Rail source
// visibility): a hidden source leaves the rail's icons and nothing else, and the palette still opens it.
const mocks = vi.hoisted(() => ({ prefs: undefined as unknown as [Accessor<Record<string, string>>, Setter<Record<string, string>>] }))
vi.mock('@tanstack/solid-query', () => ({
  createQuery: () => ({ get data() { return mocks.prefs[0]() } }),
  useQueryClient: () => ({}),
}))
vi.mock('../../infra/queries', () => ({ prefsOptions: () => ({ queryKey: ['prefs'] }) }))
vi.mock('../settings/savePref', () => ({
  savePref: async (_qc: unknown, key: string, value: string) => {
    mocks.prefs[1]((previous) => ({ ...previous, [key]: value }))
    return true
  },
}))

import { sourceRegistry } from '../../host/registries/sources/sources'
import { commandRegistry, type ActionCommand } from '../../host/registries/commands/commands'
import { availableSources } from './railSources'
import { createHiddenSourceOpeners, createRailSourceVisibility, type RailSourceVisibility } from './railSourceVisibility'
import { selectedSource, setSelectedSource } from '../tasks/tasks'

const held: Disposable[] = []
let dispose: (() => void) | undefined
let visibility!: RailSourceVisibility
const opened: string[] = []

const rail = () => availableSources(undefined).filter((source) => visibility.shown(source.id)).map((source) => source.id)
const opener = (id: string) => commandRegistry.get(`rail.source.${id}.open`) as ActionCommand | undefined

beforeEach(() => {
  mocks.prefs = createSignal<Record<string, string>>({})
  opened.length = 0
  held.push(
    // Core's own source, with no owner: never hidden.
    sourceRegistry.register({ id: 'home', order: 0, glyph: 'house', label: 'Home', isDefault: true }),
    sourceRegistry.register({ id: 'board', order: 50, glyph: 'x', label: 'Board', showInRailByDefault: false }, 'boardplugin'),
    sourceRegistry.register({ id: 'docs', order: 60, glyph: 'x', label: 'Docs' }, 'docsplugin'),
  )
  dispose = createRoot((done) => {
    visibility = createRailSourceVisibility()
    createHiddenSourceOpeners(() => availableSources(undefined), visibility.shown, (source) => opened.push(source.id))
    return done
  })
})
afterEach(() => {
  dispose?.()
  for (const entry of held.splice(0)) entry.dispose()
  setSelectedSource(null)
})

describe('rail source visibility', () => {
  it('hides a source from the rail but keeps it available, and the palette opens it', () => {
    expect(rail()).toEqual(['home', 'docs'])
    // Still on offer, so the shell keeps it on screen once something selects it.
    expect(availableSources(undefined).map((source) => source.id)).toContain('board')
    expect(opener('board')?.title).toBe('Open Board')
    opener('board')?.run({ nodeId: null, workspaceId: null, projectId: null, taskId: null, paneId: null, surfaceId: null })
    expect(opened).toEqual(['board'])
    expect(opener('docs')).toBeUndefined()
  })

  it('shows it again from the switch, and the palette row goes', async () => {
    await visibility.setShown({ pluginId: 'boardplugin', id: 'board' }, true)
    expect(rail()).toEqual(['home', 'board', 'docs'])
    expect(opener('board')).toBeUndefined()
  })

  it('goes back to Home when the source on screen is hidden', async () => {
    setSelectedSource('docs')
    await visibility.setShown({ pluginId: 'docsplugin', id: 'docs' }, false)
    expect(selectedSource()).toBe('home')
    expect(opener('docs')?.title).toBe('Open Docs')
  })

  it('leaves a plugin its own opener rather than adding a second', () => {
    held.push(commandRegistry.register({ id: 'source.board.open', title: 'Open the board', category: 'navigation', run: () => {} }))
    expect(opener('board')).toBeUndefined()
  })
})
