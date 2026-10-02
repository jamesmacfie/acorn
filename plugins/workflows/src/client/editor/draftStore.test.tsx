import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { createComponent, createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { WorkflowDef } from '../../shared/workflowContracts'
import { createDraftStore } from './draftStore'

const fixture = vi.hoisted(() => ({
  node: 'A' as string | null,
  registered: undefined as string | null | undefined,
  reads: [] as { node: string | null; path: string }[],
  writes: [] as { node: string | null; path: string; body: any }[],
  read: undefined as undefined | ((node: string | null, path: string) => Promise<unknown>),
  write: undefined as undefined | ((node: string | null, path: string, body: any) => Promise<unknown>),
}))
vi.mock('@acorn/plugin-api/client', async original => ({
  ...(await original<Record<string, unknown>>()),
  activeNodeId: () => fixture.node,
  queryOwner: () => fixture.registered,
  deviceStorage: () => localStorage,
  readJson: (path: string, options: { nodeId?: string | null } = {}) => {
    const node = options.nodeId === undefined ? fixture.node : options.nodeId
    fixture.reads.push({ node, path })
    return fixture.read!(node, path)
  },
  writeJson: (path: string, options: { nodeId?: string | null; body?: string }) => {
    const node = options.nodeId === undefined ? fixture.node : options.nodeId
    const body = JSON.parse(options.body ?? '{}')
    fixture.writes.push({ node, path, body })
    return fixture.write!(node, path, body)
  },
}))
const def = (name: string): WorkflowDef => ({ baseline: 'acorn-1', formatVersion: 1, name, steps: [] })
const row = (id = 'same', revision = 1, name = id) => ({ id, revision, def: def(name), workspaceId: 'workspace', createdAt: 0, updatedAt: 0 })
const held = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const tick = async () => { for (let i = 0; i < 3; i++) await new Promise(resolve => setTimeout(resolve, 0)) }
let dispose: (() => void) | undefined
const mount = async (initial = 'db:same') => {
  let model!: ReturnType<typeof createDraftStore>
  let select!: (item: string) => void
  createRoot(off => {
    dispose = off
    const [item, setItem] = createSignal(initial)
    select = setItem
    createComponent(QueryClientProvider, { client: new QueryClient(), get children() {
      model = createDraftStore({ projectId: () => 'project', item })
      return null
    } })
  })
  await tick()
  return { model, select }
}
beforeEach(() => {
  fixture.node = 'A'; fixture.registered = undefined; fixture.reads = []; fixture.writes = []
  localStorage.clear()
  fixture.read = async (_node, path) => path.includes('/catalog') ? { kinds: [], workflows: [], profiles: [] }
    : path.includes('/providers') || path.includes('/publications?') ? [] : row(decodeURIComponent(path.split('/').pop()!.split('?')[0]))
  fixture.write = async (_node, _path, body) => body.action === 'list' ? { operations: [] }
    : body.action === 'open' ? { draft: { revision: 1, def: def(body.target.path) } }
    : body.action === 'save' ? { draft: { revision: body.revision + 1, def: body.def } }
    : { ...row(), revision: (body.revision ?? 0) + 1, def: body.def }
})
afterEach(async () => { dispose?.(); dispose = undefined; await tick() })

it('flushes cleanup through the originating API when another Node has the same definition ID', async () => {
  const { model } = await mount()
  model.apply(value => ({ ...value, def: def('unsent A') }))
  fixture.node = 'B'
  dispose!(); dispose = undefined
  await tick()
  expect(fixture.writes.find(write => write.body.def)?.node).toBe('A')
  expect(fixture.writes.find(write => write.body.def)?.body).toMatchObject({ revision: 1, def: { name: 'unsent A' } })
})

it('preserves an explicit origin owner while the ambient selection names a Node', async () => {
  fixture.registered = null
  const { model } = await mount()
  model.apply(value => ({ ...value, def: def('origin') }))
  expect(await model.save()).toBe(true)
  expect(fixture.writes.some(write => write.body.def)).toBe(true)
  expect(fixture.reads.every(read => read.node === null)).toBe(true)
  expect(fixture.writes.every(write => write.node === null)).toBe(true)
})

it('keeps B revision, undo history, and save status after an A acknowledgement', async () => {
  const write = held<unknown>()
  fixture.write = async (_node, _path, body) => body.def ? write.promise : { operations: [] }
  const { model, select } = await mount()
  model.apply(value => ({ ...value, def: def('edited A') }))
  const saving = model.save()
  select('db:B'); await tick()
  const before = { revision: model.revision(), dirty: model.dirty(), undo: model.canUndo(), status: model.saveState() }
  write.resolve(row('same', 2, 'edited A'))
  expect(await saving).toBe(true)
  expect(model.draft().def.name).toBe('B')
  expect({ revision: model.revision(), dirty: model.dirty(), undo: model.canUndo(), status: model.saveState() }).toEqual(before)
})

it('serializes saves and keeps edits made during submission recoverable', async () => {
  const first = held<unknown>()
  let count = 0
  fixture.write = async (_node, _path, body) => !body.def ? { operations: [] } : ++count === 1 ? first.promise : row('same', body.revision + 1, body.def.name)
  const { model } = await mount()
  model.apply(value => ({ ...value, def: def('one') }))
  const saving = model.save()
  model.apply(value => ({ ...value, def: def('two') }))
  const pending = model.save()
  model.apply(value => ({ ...value, def: def('three') }))
  const latest = model.save()
  expect(count).toBe(1)
  first.resolve(row('same', 2, 'one'))
  expect(await saving).toBe(true)
  expect(await pending).toBe(true)
  expect(await latest).toBe(true)
  expect(fixture.writes.filter(write => write.body.def).map(write => [write.body.revision, write.body.def.name])).toEqual([[1, 'one'], [2, 'three']])
  expect(model.revision()).toBe(3)
  expect(model.dirty()).toBe(false)
})

it('does not mark a later edit saved when only the submitted edit lands', async () => {
  const write = held<unknown>()
  fixture.write = async (_node, _path, body) => body.def ? write.promise : { operations: [] }
  const { model } = await mount()
  model.apply(value => ({ ...value, def: def('one') }))
  const saving = model.save()
  model.apply(value => ({ ...value, def: def('two') }))
  expect(localStorage.length).toBeGreaterThan(0)
  write.resolve(row('same', 2, 'one')); await saving
  expect(model.dirty()).toBe(true)
  expect(model.saveState()).toBe('saving')
  expect(JSON.parse(localStorage.getItem('workflow-recovery:v1:["A","same",2]')!).local.name).toBe('two')
  model.apply(value => ({ ...value, def: def('one') }))
})

it('keeps a failed save and three-way conflict choices for recovery', async () => {
  const { model } = await mount()
  model.apply(value => ({ ...value, def: def('local') }))
  fixture.write = async (_node, _path, body) => { if (body.def) throw new Error('conflict'); return { operations: [] } }
  fixture.read = async () => row('same', 2, 'external')
  expect(await model.save()).toBe(false)
  expect(model.conflicts().length).toBeGreaterThan(0)
  expect(model.saveState()).toBe('conflict')
  expect(localStorage.length).toBeGreaterThan(0)
  model.resolveConflict(model.conflicts()[0].path, 'local')
  expect(model.draft().def.name).toBe('local')
})

it('ignores a delayed publication list and held publication after replacing the definition', async () => {
  const publications = held<unknown>()
  const original = fixture.read!
  fixture.read = (node, path) => path.includes('/publications?') ? publications.promise : original(node, path)
  const { model, select } = await mount()
  select('db:B'); await tick()
  publications.resolve([{ id: 'operation-A', rootId: 'same', state: 'review' }]); await tick()
  expect(model.publication()).toBeUndefined()
  const preparing = held<unknown>()
  fixture.write = async (_node, path) => path.includes('/prepare') ? preparing.promise : { operations: [] }
  const work = model.preparePublication()
  await tick(); select('db:C'); await tick()
  preparing.resolve({ id: 'operation-B', rootId: 'B', state: 'review' }); await work
  expect(model.publication()).toBeUndefined()
})

it('waits for the originating save before export and stops after a selection change', async () => {
  const write = held<unknown>()
  fixture.write = async (_node, _path, body) => body.def ? write.promise : { operations: [] }
  const { model, select } = await mount()
  model.apply(value => ({ ...value, def: def('submitted') }))
  const exporting = model.prepareExport()
  await tick(); select('db:B'); await tick()
  write.resolve(row('same', 2, 'submitted')); await exporting
  expect(fixture.writes.some(write => write.body.action === 'export')).toBe(false)
})

it('captures a file target for load and cleanup across source navigation', async () => {
  const file = held<unknown>()
  const original = fixture.write!
  fixture.write = (node, path, body) => body.action === 'open' && body.target.source === 'repo' ? file.promise : original(node, path, body)
  const { model, select } = await mount('repo:first')
  select('user:second'); await tick()
  file.resolve({ draft: { revision: 1, def: def('late repo') } }); await tick()
  expect(model.draft().def.name).toBe('.acorn/workflows/second.toml')
  model.apply(value => ({ ...value, def: def('edited user') }))
  fixture.node = 'B'; dispose!(); dispose = undefined; await tick()
  expect(fixture.writes.find(write => write.body.action === 'save')).toMatchObject({ node: 'A', body: { target: { source: 'user', path: '.acorn/workflows/second.toml', projectId: 'project' } } })
})

it('keeps the full draft when device storage fails and recovers a failed save on remount', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
  const { model } = await mount()
  model.apply(value => ({ ...value, def: def('recover me') }))
  fixture.write = async () => { throw new Error('offline') }
  expect(await model.save()).toBe(false)
  expect(model.draft().def.name).toBe('recover me')
  storage.mockRestore()
  expect(await model.save()).toBe(false)
  dispose!(); dispose = undefined; await tick()
  const again = await mount()
  expect(again.model.draft().def.name).toBe('recover me')
  expect(again.model.dirty()).toBe(true)
})

it('keeps edits made during a held file review dirty and recoverable', async () => {
  const { model } = await mount('repo:first')
  const review = held<unknown>()
  const original = fixture.write!
  fixture.write = (node, path, body) => body.action === 'review' ? review.promise : original(node, path, body)
  const reviewing = model.preparePublication(); await tick()
  model.apply(value => ({ ...value, def: def('edited during review') }))
  review.resolve({ draft: { revision: 2, def: def('.acorn/workflows/first.toml') } })
  await reviewing
  expect(model.draft().def.name).toBe('edited during review')
  expect(model.dirty()).toBe(true)
  expect(JSON.parse(localStorage.getItem('workflow-recovery:v1:["A","project:repo:first",2]')!).local.name).toBe('edited during review')
})

it('reuses an inflight entity after navigating away and back without overlapping writes', async () => {
  const first = held<unknown>()
  let calls = 0
  fixture.write = async (_node, _path, body) => !body.def ? { operations: [] }
    : ++calls === 1 ? first.promise : row('same', body.revision + 1, body.def.name)
  const { model, select } = await mount()
  model.apply(value => ({ ...value, def: def('first edit') }))
  const save = model.save()
  select('db:B'); await tick(); select('db:same'); await tick()
  expect(model.draft().def.name).toBe('first edit')
  model.apply(value => ({ ...value, def: def('second edit') }))
  const next = model.save()
  expect(calls).toBe(1)
  first.resolve(row('same', 2, 'first edit')); await save; await next
  expect(model.revision()).toBe(3)
  expect(model.draft().def.name).toBe('second edit')
  expect(model.dirty()).toBe(false)
})

it('submits file conflict choices with the captured external hash without requiring a dirty save', async () => {
  const { model } = await mount('repo:first')
  const original = fixture.write!
  let reviews = 0
  fixture.write = async (node, path, body) => body.action !== 'review' ? original(node, path, body)
    : ++reviews === 1 ? { draft: { revision: 1, def: def('.acorn/workflows/first.toml') },
      conflicts: [{ path: '/name', base: 'base', local: 'local', external: 'external' }], externalHash: 'hash-one' }
    : { draft: { revision: 2, def: def('external') } }
  await model.preparePublication()
  expect(model.fileConflicts()).toHaveLength(1)
  model.resolveFileConflict('/name', 'external'); await tick()
  expect(reviews).toBe(2)
  expect(fixture.writes.filter(write => write.body.action === 'review')[1].body).toMatchObject({ choices: { '/name': 'external' }, externalHash: 'hash-one', revision: 1 })
  expect(model.draft().def.name).toBe('external')
  expect(model.fileConflicts()).toEqual([])
})
