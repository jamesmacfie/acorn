import { afterEach, describe, expect, it } from 'vitest'
import { setActiveTaskId, setSelectedSource } from '@acorn/client-core/features/tasks/tasks.ts'
import { sourceRegistry } from '@acorn/client-core/host/registries/sources/sources.ts'
import type { Disposable } from '@acorn/client-core/kit/lib/registry.ts'
import { BROWSE, MENU, PANES, SOURCE, TASKS, topology } from './topology'

// The shell's answers to the three questions the keys module cannot answer for itself.
//
// Worth a test of its own because every one of them used to be a literal somewhere else, and because
// each is a pure function of two signals: what is selected and whether the selected source draws a
// list. A render test would have to reach five regions to say what these four cases say.

const source = (id: string, list: boolean): Disposable => sourceRegistry.register({
  id, label: id, glyph: 'circle', order: 1,
  ...(list ? { regions: { list: () => null, detail: () => null } } : { component: () => null }),
} as unknown as Parameters<typeof sourceRegistry.register>[0])

describe('the shell topology', () => {
  const registered: Disposable[] = []
  afterEach(() => {
    for (const entry of registered.splice(0)) entry.dispose()
    setSelectedSource(null)
    setActiveTaskId(null)
  })

  it('opens on Tasks only when the session started with a task and no source', () => {
    expect(topology.opensOn()).toEqual(MENU)
    setActiveTaskId('task-1')
    expect(topology.opensOn()).toEqual(TASKS)
    setSelectedSource('probe')
    expect(topology.opensOn()).toEqual(MENU)
  })

  it('passes over the pane strip on a first crossing and over nothing else', () => {
    expect(topology.skips(PANES)).toBe(true)
    for (const ref of [MENU, BROWSE, TASKS, SOURCE]) expect(topology.skips(ref)).toBe(false)
  })

  it('sends a source detail back to the list it came from, or to the row that chose it', () => {
    registered.push(source('with-list', true), source('no-list', false))
    setSelectedSource('with-list')
    expect(topology.home(SOURCE)).toEqual(BROWSE)
    setSelectedSource('no-list')
    expect(topology.home(SOURCE)).toEqual(MENU)
  })

  it('sends the pane strip to Tasks, a pane region to the strip, and the rail nowhere', () => {
    expect(topology.home(PANES)).toEqual(TASKS)
    expect(topology.home({ paneId: 'notes', regionId: 'body' })).toEqual(PANES)
    for (const ref of [MENU, BROWSE, TASKS]) expect(topology.home(ref)).toBeNull()
  })
})
