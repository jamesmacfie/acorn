import { createRoot, createSignal } from 'solid-js'
import { afterAll, afterEach, expect, it, vi } from 'vitest'
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { activeNodeId, setActiveNode } from '../../packages/client-core/src/infra/node/activeNode'

const state = vi.hoisted(() => ({ node: 'node-A', writes: [] as unknown[], delayed: undefined as undefined | ((value: unknown) => void) }))
// Both disposable Nodes are connected. Keep request delivery and Node selection real.
vi.mock('../../packages/client-core/src/infra/node/fleet', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()), nodeState: () => 'connected',
}))
vi.mock('@acorn/plugin-api/client', async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceStorage: () => localStorage,
  debounce: (callback: (...args: unknown[]) => unknown, ms: number) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const invoke = (...args: unknown[]) => { if (timer) clearTimeout(timer); timer = setTimeout(() => callback(...args), ms) }
    invoke.cancel = () => { if (timer) clearTimeout(timer) }
    return invoke
  },
}))
vi.mock('../../plugins/workflows/src/client/layoutPrefs', () => ({ forgetLayout: () => {}, renameInLayout: () => {} }))
const definition = (id: string) => ({ baseline: 'acorn-1', formatVersion: 1, name: `Definition ${id}`, steps: [] })
vi.mock('../../plugins/workflows/src/client/workflowsClient', async importOriginal => ({
  workflowApi: {
    ...(await importOriginal<{ workflowApi: Record<string, unknown> }>()).workflowApi,
    def: async (id: string) => ({ id, workspaceId: 'workspace', name: id, revision: id === 'A' ? 1 : 5, def: definition(id) }),
    files: async () => ({ operations: [] }), publications: async () => [], catalog: async () => ({ kinds: [], profiles: [] }), providers: async () => [],
    validateDef: async () => ({ problems: [] }),
  },
}))
const { createDraftStore } = await import('../../plugins/workflows/src/client/editor/draftStore')
const results: unknown[] = []
const roots = new Set<() => void>()
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const mount = async () => {
  Object.assign(window, { acorn: { desktop: true, onNodeStatus: () => () => {},
    nodeFetch: async (nodeId: string, request: { path: string; body: { kind: 'bytes'; bytes: Uint8Array } }) => {
      state.writes.push({ nodeId, path: request.path, ...JSON.parse(new TextDecoder().decode(request.body.bytes)) })
      const row = await new Promise(resolve => { state.delayed = resolve })
      return { status: 200, headers: {}, body: new TextEncoder().encode(JSON.stringify(row)) }
    },
  } })
  setActiveNode('node-A')
  let model!: ReturnType<typeof createDraftStore>, select!: (value: string) => void, dispose!: () => void
  createRoot(off => { dispose = off; roots.add(off); const [item, setItem] = createSignal('db:A'); select = setItem
    model = createDraftStore({ projectId: () => 'project', item }) })
  await tick()
  return { model, select, dispose }
}
afterEach(() => { for (const off of roots) off(); roots.clear(); state.writes = []; state.delayed = undefined; state.node = 'node-A'; setActiveNode(null); localStorage.clear(); delete (window as any).acorn })

it('records a delayed save acknowledgment after navigating to another definition', async () => {
  const { model, select } = await mount()
  expect(model.revision()).toBe(1)
  model.apply(current => ({ ...current, def: { ...current.def, name: 'Edited A' } }))
  const saving = model.save()
  await tick()
  expect(state.writes).toHaveLength(1)
  select('db:B'); await tick()
  expect(model.draft().def.name).toBe('Definition B'); expect(model.revision()).toBe(5)
  const beforeAck = { definition: model.draft().def.name, revision: model.revision(), dirty: model.dirty() }
  state.delayed?.({ id: 'A', revision: 2, def: { ...definition('A'), name: 'Edited A' } })
  expect(await saving).toBe(true); await tick()
  const afterAck = { definition: model.draft().def.name, revision: model.revision(), dirty: model.dirty() }
  expect(afterAck.definition).toBe('Definition B')
  // Characterization only; an after run must instead assert B remains revision 5 and clean.
  results.push({ case: 'obsolete-definition-save-ack', beforeAck, afterAck, writes: [...state.writes] })
})

it('records the Node selected by a cleanup save after the active Node changes', async () => {
  const { model, dispose } = await mount()
  model.apply(current => ({ ...current, def: { ...current.def, name: 'Unsent A' } }))
  setActiveNode('node-B'); expect(activeNodeId()).toBe('node-B'); dispose(); roots.delete(dispose)
  await tick()
  expect({ writes: state.writes, dirty: model.dirty(), message: model.message(), busy: model.busy() }).toEqual({ writes: [expect.any(Object)], dirty: true, message: undefined, busy: true })
  state.delayed?.({ id: 'A', revision: 2, def: { ...definition('A'), name: 'Unsent A' } }); await tick()
  results.push({ case: 'outgoing-node-cleanup-save', originatingNode: 'node-A', writes: [...state.writes] })
})

afterAll(() => {
  const tag = process.env.ACORN_PERF_TAG ?? 'sample'
  if (!/^[a-z0-9-]+$/.test(tag)) throw new Error('Use a safe evidence tag.')
  const path = resolve(`plans/performance/14-authoring-${tag}.json`)
  // Each test appends to this run's in-memory evidence; never overwrite another before run.
  if (tag.startsWith('before') && existsSync(path)) throw new Error('Before evidence exists.')
  writeFileSync(path, JSON.stringify(results, null, 2) + '\n')
})
