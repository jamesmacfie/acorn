import { createRoot } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DashboardDraft, PanelPlan } from '@acorn/protocol/dashboards.ts'
import { dashboardRecoveryStore } from '../dashboardRecovery'
import { blankPlan, createStudioStore, type StudioReview } from './studioStore'

const memory = () => {
  const values = new Map<string, string>()
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => void values.set(key, value), removeItem: (key: string) => void values.delete(key) }
}
const draft = (content: PanelPlan, draftRevision = 1): DashboardDraft =>
  ({ id: 'd1', workspaceId: 'w', content, draftRevision, basePublishedRevision: null, publishedRevision: null, updatedAt: 0 } as DashboardDraft)
// A plan the schema accepts, which a blank plan with no source isn't.
const sourced = (plan: PanelPlan): PanelPlan => ({ ...plan, sources: [{ id: 'tasks', label: 'Tasks', role: 'primary', reference: { kind: 'inline', bindings: {}, content: {
  name: 'Tasks', parameters: { type: 'object', properties: {}, additionalProperties: false }, sourceParameters: {},
  query: { source: { pluginId: 'core', sourceId: 'tasks' }, scope: { workspaceId: 'w', parameters: {} }, sort: [] },
} } }] })
const titled = (title: string) => (plan: PanelPlan): PanelPlan => ({ ...plan, title })

const proposal = (base: PanelPlan, candidate: PanelPlan) => ({ state: 'proposal', base, candidate, baseRevision: 0, summary: 'Renamed', diff: [], problems: [],
  context: [], usage: { requests: 1, inputTokens: 0, outputTokens: 0 }, providerId: 'p', modelId: 'm' }) as StudioReview['proposal']

let dispose: () => void
const setup = () => {
  const client = { create: vi.fn(async (content: PanelPlan) => draft(content)), save: vi.fn(async (_id: string, revision: number, content: PanelPlan) => draft(content, revision + 1)) }
  const conversations = memory()
  const store = createRoot(done => { dispose = done; return createStudioStore({ nodeId: 'n', client, recovery: dashboardRecoveryStore(memory()), recoveryId: 'new:w', conversations }) })
  return { store, client, conversations }
}

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0) })
afterEach(() => { dispose(); vi.useRealTimers() })

describe('studio store', () => {
  it('makes each change an undo step and clears redo on a new change', () => {
    const { store } = setup()
    store.apply(titled('One'))
    vi.advanceTimersByTime(1000)
    store.apply(titled('Two'))
    store.undo()
    expect(store.plan().title).toBe('One')
    store.redo()
    expect(store.plan().title).toBe('Two')
    store.undo()
    store.apply(titled('Three'))
    expect(store.canRedo()).toBe(false)
    store.undo()
    store.undo()
    expect(store.plan().title).toBe(blankPlan().title)
  })

  it('coalesces typing within 600 ms into one step', () => {
    const { store } = setup()
    store.apply(titled('A'), { coalesce: true })
    vi.advanceTimersByTime(300)
    store.apply(titled('AB'), { coalesce: true })
    vi.advanceTimersByTime(700)
    store.apply(titled('ABC'), { coalesce: true })
    store.undo()
    expect(store.plan().title).toBe('AB')
    store.undo()
    expect(store.plan().title).toBe(blankPlan().title)
  })

  it('folds a derived change into the step that caused it and keeps redo', () => {
    const { store } = setup()
    store.apply(titled('Picked'))
    store.apply(plan => ({ ...plan, refresh: 60 }), { derived: true })
    store.undo()
    expect(store.plan()).toMatchObject({ title: blankPlan().title })
    expect(store.plan().refresh).toBeUndefined()
    store.redo()
    store.apply(plan => ({ ...plan, refresh: 30 }), { derived: true })
    expect(store.canUndo()).toBe(true)
  })

  it('keeps at most 60 undo steps', () => {
    const { store } = setup()
    for (let index = 0; index < 70; index += 1) store.apply(titled(`Title ${index}`))
    let steps = 0
    while (store.canUndo()) { store.undo(); steps += 1 }
    expect(steps).toBe(60)
    expect(store.plan().title).toBe('Title 9')
  })

  it('selects without an undo step', () => {
    const { store } = setup()
    store.select('look')
    expect(store.selected()).toBe('look')
    expect(store.canUndo()).toBe(false)
  })

  it('saves to the Node 750 ms after the last change to a valid plan', async () => {
    const { store, client } = setup()
    store.apply(plan => titled('First')(sourced(plan)))
    expect(store.saveState()).toBe('Saved on this computer')
    vi.advanceTimersByTime(500)
    store.apply(titled('Second'))
    vi.advanceTimersByTime(700)
    expect(client.create).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(100)
    expect(client.create).toHaveBeenCalledTimes(1)
    expect(client.create.mock.calls[0]![0].title).toBe('Second')
    expect(store.saveState()).toBe('Saved')
    store.apply(titled('Third'))
    await vi.advanceTimersByTimeAsync(750)
    expect(client.save).toHaveBeenCalledWith('d1', 1, expect.objectContaining({ title: 'Third' }))
  })

  it('keeps a plan that does not parse on this computer only', async () => {
    const { store, client } = setup()
    store.apply(titled(''))
    await vi.advanceTimersByTimeAsync(2000)
    expect(client.create).not.toHaveBeenCalled()
    expect(store.saveState()).toBe('Saved on this computer')
  })

  it('opens a draft without an undo step', () => {
    const { store } = setup()
    store.apply(titled('Typed'))
    store.open(draft({ ...blankPlan(), title: 'Loaded' }))
    expect(store.plan().title).toBe('Loaded')
    expect(store.canUndo()).toBe(false)
  })

  it('reviews a proposal and applies it as one undo step', () => {
    const { store } = setup()
    store.apply(titled('Mine'))
    store.reviewProposal(proposal(store.plan(), titled('Proposed')(store.plan())))
    expect(store.review()?.merged.title).toBe('Proposed')
    expect(store.plan().title).toBe('Mine')
    expect(store.canUndo()).toBe(false)
    store.applyReview()
    expect(store.review()).toBeUndefined()
    expect(store.plan().title).toBe('Proposed')
    store.undo()
    expect(store.plan().title).toBe('Mine')
  })

  it('rebases a proposal over an edit it does not touch, and discards without a change', () => {
    const { store } = setup()
    const base = store.plan()
    store.apply(plan => ({ ...plan, refresh: 60 }))
    store.reviewProposal(proposal(base, titled('Proposed')(base)))
    expect(store.review()?.merged).toMatchObject({ title: 'Proposed', refresh: 60 })
    store.reviewProposal(undefined)
    expect(store.review()).toBeUndefined()
    expect(store.plan().title).toBe(blankPlan().title)
  })

  it('ends review when the plan changed where the proposal did', () => {
    const { store } = setup()
    const base = store.plan()
    store.apply(titled('Edited meanwhile'))
    store.reviewProposal(proposal(base, titled('Proposed')(base)))
    expect(store.review()).toBeUndefined()
    expect(store.problem()).toBe('This panel changed while the proposal was prepared.')
  })

  it("moves a new panel's AI conversation to its draft id when the Node assigns one", async () => {
    const { store, conversations } = setup()
    conversations.setItem('acorn:ai-authoring:v1:n:dashboard:new:w', '{"context":[]}')
    store.apply(plan => titled('First')(sourced(plan)))
    await vi.advanceTimersByTimeAsync(750)
    expect(conversations.getItem('acorn:ai-authoring:v1:n:dashboard:d1')).toBe('{"context":[]}')
    expect(conversations.getItem('acorn:ai-authoring:v1:n:dashboard:new:w')).toBeNull()
  })
})
