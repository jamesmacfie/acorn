import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Component } from 'solid-js'
import {
  CORE_SLOT_PROVIDER,
  clearExclusiveSlotFailures,
  exclusiveSlotChoices,
  exclusiveSlotFailed,
  exclusiveSlotOffers,
  exclusiveSlotRegistry,
  noteExclusiveSlotFailure,
  registerCoreExclusiveSlot,
  resolveExclusiveSlot,
  withExclusiveSlotChoice,
} from './exclusiveSlots'

// The exclusive-slot arbitration (docs/plugins.md § Replacing a core surface).
//
// The component is never rendered here: this repo's vitest runs in bare Node with no Solid transform
// (docs/frontend/registries.md § Registries and plugins), so the arbitration is a plain function over a
// registry, which can be tested; what the chosen provider draws cannot be, and is not claimed to be.

const NOTHING = (() => null) as unknown as Component
let core: { dispose(): void }
beforeEach(() => { core = registerCoreExclusiveSlot('rail.taskList', NOTHING) })

const offer = (pluginId: string, over: { when?: () => boolean } = {}) =>
  exclusiveSlotRegistry.register({
    id: `plugin:${pluginId}:rail`,
    pluginId,
    slot: 'rail.taskList',
    label: `${pluginId} task list`,
    component: NOTHING,
    ...over,
  })

// Each test disposes what it registered; the failure set is module state and has no owner, so it is
// cleared here.
afterEach(() => { core.dispose(); clearExclusiveSlotFailures() })

describe('resolveExclusiveSlot', () => {
  it.each(['pane.switcher', 'rail', 'topbar'] as const)('%s keeps core after a provider disappears or fails', (slot) => {
    const coreSlot = registerCoreExclusiveSlot(slot, NOTHING)
    const offered = exclusiveSlotRegistry.register({
      id: `plugin:chrome:${slot}`, pluginId: 'chrome', slot, label: 'Chrome', component: NOTHING,
    })
    expect(resolveExclusiveSlot(slot, undefined).pluginId).toBe('core')
    expect(resolveExclusiveSlot(slot, 'chrome').pluginId).toBe('chrome')
    noteExclusiveSlotFailure(slot, 'chrome')
    noteExclusiveSlotFailure(slot, 'chrome')
    noteExclusiveSlotFailure(slot, 'chrome')
    expect(resolveExclusiveSlot(slot, 'chrome').pluginId).toBe('core')
    offered.dispose()
    clearExclusiveSlotFailures()
    expect(resolveExclusiveSlot(slot, 'chrome').pluginId).toBe('core')
    coreSlot.dispose()
  })
  it('answers core when nobody has offered', () => {
    expect(resolveExclusiveSlot('rail.taskList', undefined).pluginId).toBe('core')
    expect(resolveExclusiveSlot('rail.taskList', 'board').pluginId).toBe('core')
  })

  it('registering an offer replaces nothing', () => {
    const a = offer('board')
    const b = offer('tracker')
    // Two packages both offering, and the rail still draws its own list.
    expect(exclusiveSlotOffers('rail.taskList').map((entry) => entry.pluginId)).toEqual(['board', 'tracker'])
    expect(resolveExclusiveSlot('rail.taskList', undefined).pluginId).toBe('core')
    expect(resolveExclusiveSlot('rail.taskList', CORE_SLOT_PROVIDER).pluginId).toBe('core')
    a.dispose()
    b.dispose()
  })

  it('honours the user’s choice, and only that one', () => {
    const a = offer('board')
    const b = offer('tracker')
    expect(resolveExclusiveSlot('rail.taskList', 'tracker')?.pluginId).toBe('tracker')
    expect(resolveExclusiveSlot('rail.taskList', 'nobody').pluginId).toBe('core')
    a.dispose()
    b.dispose()
  })

  it('falls back to core when the chosen provider goes away', () => {
    const a = offer('board')
    expect(resolveExclusiveSlot('rail.taskList', 'board')?.pluginId).toBe('board')
    // Uninstalled, or simply not on the node this window is looking at.
    a.dispose()
    expect(resolveExclusiveSlot('rail.taskList', 'board').pluginId).toBe('core')
  })

  it('falls back to core when the chosen provider is not running here', () => {
    const a = offer('board', { when: () => false })
    expect(resolveExclusiveSlot('rail.taskList', 'board').pluginId).toBe('core')
    a.dispose()
  })

  it('falls back to core when the chosen provider threw, and stays there', () => {
    const a = offer('board')
    noteExclusiveSlotFailure('rail.taskList', 'board')
    noteExclusiveSlotFailure('rail.taskList', 'board')
    expect(resolveExclusiveSlot('rail.taskList', 'board')?.pluginId).toBe('board')
    noteExclusiveSlotFailure('rail.taskList', 'board')
    expect(exclusiveSlotFailed('rail.taskList', 'board')).toBe(true)
    expect(resolveExclusiveSlot('rail.taskList', 'board').pluginId).toBe('core')
    // Still an offer. Settings has to keep showing it, or the owner cannot tell why their choice is
    // not in effect.
    expect(exclusiveSlotOffers('rail.taskList').map((entry) => entry.pluginId)).toEqual(['board'])
    // A contribution sync is the one moment the bytes can have changed, so it is the one moment the
    // provider earns another attempt.
    clearExclusiveSlotFailures()
    expect(resolveExclusiveSlot('rail.taskList', 'board')?.pluginId).toBe('board')
    a.dispose()
  })
})

describe('the stored arbitration', () => {
  it('round-trips a choice and forgets it again', () => {
    const stored = withExclusiveSlotChoice(undefined, 'rail.taskList', 'board')
    expect(exclusiveSlotChoices(stored)).toEqual({ 'rail.taskList': 'board' })
    // Choosing core removes the entry rather than storing a sentinel, so the preference holds only
    // the replacements the owner actually asked for.
    expect(exclusiveSlotChoices(withExclusiveSlotChoice(stored, 'rail.taskList', CORE_SLOT_PROVIDER))).toEqual({})
  })

  it('reads a malformed preference as core rather than throwing', () => {
    // A bad preference must not be able to take somebody's task list away, and must not be able to
    // crash the rail either. This value is read on every render of the shell's left edge.
    for (const raw of ['', 'not json', '[]', 'null', '"board"', '{"rail.taskList": 3}', '{"rail.taskList": ""}']) {
      expect(exclusiveSlotChoices(raw)).toEqual({})
    }
  })

  it('drops a choice for a slot this shell does not have', () => {
    // Version skew in the other direction: a preference written by a newer build naming a designated
    // surface this one has no host for. Dropped, because there is nothing here to honour it with.
    expect(exclusiveSlotChoices('{"rail.taskList":"board","sidebar.future":"board"}')).toEqual({ 'rail.taskList': 'board' })
  })
})
