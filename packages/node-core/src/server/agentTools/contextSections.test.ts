import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  asContextSection,
  getContextSections,
  parseInclude,
  registerContextSection,
  removeContextSections,
  type PluginContextSection,
} from './contextSections'

// `order` defaults to the four real ids' declared values so the cases below read the way they did
// before order moved onto the contribution; anything else gets a high number, i.e. "unlisted".
const ORDERS: Record<string, number> = { pr: 10, issues: 20, notes: 30, memory: 40 }

const section = (id: string, over: Partial<PluginContextSection> = {}): PluginContextSection => ({
  id,
  order: ORDERS[id] ?? 900,
  label: id,
  defaultIncluded: false,
  budget: { overflow: 'truncate-tail' },
  assemble: async () => ({ items: [] }),
  format: () => '',
  ...over,
})

const args = { userLogin: 'james', task: { id: 't1' } as never, repo: 'acme/api' }

describe('the context-section registry', () => {
  // BEFORE as well as after, because importing this module now registers core's real `issues` section at
  // module scope (that is the fix for a standalone node losing it). Every case below builds a synthetic
  // registry, and two of them register their own 'issues' — which would collide with the real one on the
  // FIRST case, before any afterEach has run.
  beforeEach(() => {
    for (const owner of ['a', 'b', 'core', 'github']) removeContextSections(owner)
  })
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

  it('places a section by its declared order, wherever it registers', () => {
    registerContextSection('a', asContextSection(section('memory')))
    registerContextSection('b', asContextSection(section('experimental')))
    expect(getContextSections().map((s) => s.id)).toEqual(['memory', 'experimental'])
  })

  // The point of declaring order rather than ranking a list in core: a new section can land BETWEEN two
  // existing ones. Under the old SECTION_ORDER array it could only ever go last.
  it('lets a new section slot between two existing ones', () => {
    registerContextSection('a', asContextSection(section('pr')))
    registerContextSection('b', asContextSection(section('memory')))
    registerContextSection('b', asContextSection(section('scratch', { order: 25 })))
    expect(getContextSections().map((s) => s.id)).toEqual(['pr', 'scratch', 'memory'])
  })

  it('refuses a duplicate id and names both owners', () => {
    registerContextSection('a', asContextSection(section('notes')))
    expect(() => registerContextSection('b', asContextSection(section('notes')))).toThrow(/already registered by 'a', now by 'b'/)
  })

  it('removes one owner contributions as a unit, leaving the rest', () => {
    // What the plugin host calls before re-registering. Without it, a second startServiceRuntime in one
    // process would either throw on the duplicate id or keep sections closed over the first boot's handles.
    //
    // Owner 'a' gets TWO sections, deliberately. With one, a `remove` that stopped after the first match — the
    // easiest way to write that loop wrong, and the reason the registry iterates backwards with a splice —
    // passed this case. Two is the smallest number that can tell "as a unit" from "one of them".
    registerContextSection('a', asContextSection(section('notes')))
    registerContextSection('a', asContextSection(section('pr')))
    registerContextSection('b', asContextSection(section('memory')))
    expect(getContextSections().map((s) => s.id)).toEqual(['pr', 'notes', 'memory'])
    removeContextSections('a')
    expect(getContextSections().map((s) => s.id)).toEqual(['memory'])
  })

  it('never hands a plugin section core database handle', async () => {
    let seen: Record<string, unknown> = {}
    registerContextSection('github', asContextSection(section('pr', {
      assemble: async (a) => ((seen = a as unknown as Record<string, unknown>), { items: [] }),
    })))
    await getContextSections()[0].assemble({ ...args, db: { marker: 'core-handle' } as never })
    expect(seen).not.toHaveProperty('db')
    expect(seen).toMatchObject({ userLogin: 'james', repo: 'acme/api' })
  })

  it('resolves include=* and the defaults against what is actually registered', () => {
    // A disabled plugin does not register, so its section ID is not includable.
    registerContextSection('a', asContextSection(section('notes', { defaultIncluded: true })))
    registerContextSection('b', asContextSection(section('memory')))
    expect([...parseInclude('*')].sort()).toEqual(['memory', 'notes'])
    expect([...parseInclude(undefined)]).toEqual(['notes'])
    expect([...parseInclude('memory,pr')]).toEqual(['memory']) // 'pr' is not registered here
  })
})
