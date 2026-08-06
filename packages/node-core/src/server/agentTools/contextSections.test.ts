import { afterEach, describe, expect, it } from 'vitest'
import {
  asContextSection,
  getContextSections,
  parseInclude,
  registerContextSection,
  removeContextSections,
  type PluginContextSection,
} from './contextSections'

// The context-section contribution point (docs/vNext/plan.md § Phase 3, item 3).
//
// It replaced `setContextSections(buildContextSections({ notes, memory, pullRequest }))` — one slot that had
// to be filled with every source at once, which is why apps/node/src/wiring/contextSectionsWiring.ts had to
// exist and why neither notes nor memory could own its own half. Three properties are worth pinning: the
// wire ORDER cannot depend on registration order, an owner's contributions come out as a unit, and a
// plugin's section can never see core's database handle.

const section = (id: string, over: Partial<PluginContextSection> = {}): PluginContextSection => ({
  id,
  label: id,
  defaultIncluded: false,
  budget: { overflow: 'truncate-tail' },
  assemble: async () => ({ items: [] }),
  format: () => '',
  ...over,
})

const args = { userLogin: 'james', task: { id: 't1' } as never, repo: 'acme/api' }

describe('the context-section registry', () => {
  afterEach(() => {
    for (const owner of ['a', 'b', 'core', 'github']) removeContextSections(owner)
  })

  it('orders sections by the wire contract, not by registration order', () => {
    // Registered backwards on purpose. The assembled block's section order is what every existing prompt,
    // the client's Manifest preview and the byte-exactness invariant assume, so it must not be able to
    // change when the plugin list is reordered by domain — the exact trap `ready()` exists for elsewhere.
    registerContextSection('a', asContextSection(section('memory')))
    registerContextSection('a', asContextSection(section('notes')))
    registerContextSection('b', asContextSection(section('issues')))
    registerContextSection('b', asContextSection(section('pr')))
    expect(getContextSections().map((s) => s.id)).toEqual(['pr', 'issues', 'notes', 'memory'])
  })

  it('puts an unlisted section last rather than dropping it', () => {
    registerContextSection('a', asContextSection(section('memory')))
    registerContextSection('b', asContextSection(section('experimental')))
    expect(getContextSections().map((s) => s.id)).toEqual(['memory', 'experimental'])
  })

  it('refuses a duplicate id and names both owners', () => {
    registerContextSection('a', asContextSection(section('notes')))
    expect(() => registerContextSection('b', asContextSection(section('notes')))).toThrow(/already registered by 'a', now by 'b'/)
  })

  it('removes one owner contributions as a unit, leaving the rest', () => {
    // What the plugin host calls before re-registering. Without it, a second startServiceRuntime in one
    // process would either throw on the duplicate id or keep sections closed over the first boot's handles.
    registerContextSection('a', asContextSection(section('notes')))
    registerContextSection('b', asContextSection(section('memory')))
    removeContextSections('a')
    expect(getContextSections().map((s) => s.id)).toEqual(['memory'])
  })

  it('never hands a plugin section core database handle', async () => {
    // The one property PluginContextSection exists for. asContextSection widens the args, and this asserts
    // it widens by DROPPING rather than by passing through — a plugin reading core's tables is exactly what
    // Phase 2's database split closed.
    let seen: Record<string, unknown> = {}
    registerContextSection('github', asContextSection(section('pr', {
      assemble: async (a) => ((seen = a as unknown as Record<string, unknown>), { items: [] }),
    })))
    await getContextSections()[0].assemble({ ...args, db: { marker: 'core-handle' } as never })
    expect(seen).not.toHaveProperty('db')
    expect(seen).toMatchObject({ userLogin: 'james', repo: 'acme/api' })
  })

  it('resolves include=* and the defaults against what is actually registered', () => {
    // A disabled plugin does not register, so its id is simply not includable — which is what replaced the
    // old thunk-returns-undefined degradation.
    registerContextSection('a', asContextSection(section('notes', { defaultIncluded: true })))
    registerContextSection('b', asContextSection(section('memory')))
    expect([...parseInclude('*')].sort()).toEqual(['memory', 'notes'])
    expect([...parseInclude(undefined)]).toEqual(['notes'])
    expect([...parseInclude('memory,pr')]).toEqual(['memory']) // 'pr' is not registered here
  })
})
