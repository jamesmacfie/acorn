import { render } from 'solid-js/web'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { afterEach, expect, it, vi } from 'vitest'
import { activeNodeId, setActiveNode } from '@acorn/plugin-api/client'
import { notesSelectionFor } from './notesPaneState'
import type { Note, NotesApi } from './notesClient'
import { createNotesModel, type NotesModel } from './notesModel'

const { api } = vi.hoisted(() => ({ api: {} as NotesApi }))
vi.mock('./notesClient', async (original) => ({ ...await original<object>(), notesApi: () => api }))
const summary = { slug: 'scratchpad', title: 'Scratchpad', author: 'user', kind: 'scratch', included: true, originTaskId: null, updatedAt: 1 } as const
const note = (slug: string): Note => ({ ...summary, slug, body: `body-${slug}`, originSessionId: null, createdAt: 1 })
const tick = async () => { for (let i = 0; i < 5; i++) await new Promise((resolve) => setTimeout(resolve, 0)) }
const stops: (() => void)[] = []
afterEach(() => { for (const stop of stops.splice(0)) stop(); setActiveNode(null); vi.restoreAllMocks() })

async function mount(taskId: string, empty = false) {
  setActiveNode(null)
  Object.assign(api, {
    list: vi.fn(async () => empty ? [] : [summary]), read: vi.fn(async (_location, slug) => note(slug)),
    write: vi.fn(async () => ({ ok: true })), setTitle: vi.fn(async () => ({ ok: true })),
    create: vi.fn(async () => ({ slug: 'created' })), remove: vi.fn(async () => ({ ok: true })), setIncluded: vi.fn(async () => ({ ok: true })),
  })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  let model!: NotesModel
  const Model = () => { model = createNotesModel(taskId, null); return null }
  const stop = render(() => <QueryClientProvider client={client}><Model /></QueryClientProvider>, document.createElement('div'))
  stops.push(() => { stop(); client.clear() })
  await tick()
  return { model, stop }
}

it('saves edits made during a held read on the outgoing document and ignores an older read', async () => {
  const { model } = await mount('held-read')
  let release!: (note: Note) => void
  api.read = vi.fn((_location, slug) => slug === 'held' ? new Promise<Note>((resolve) => { release = resolve }) : Promise.resolve(note(slug)))
  const opening = model.open('task', 'held')
  model.onBodyInput('intervening body')
  model.onTitleInput('intervening title')
  release(note('held'))
  await opening; await tick()
  expect(api.write).toHaveBeenCalledWith({ scope: 'task', taskId: 'held-read' }, 'scratchpad', 'intervening body')
  expect(api.setTitle).toHaveBeenCalledWith({ scope: 'task', taskId: 'held-read' }, 'scratchpad', 'intervening title')
  const stale = model.open('task', 'held')
  await model.open('task', 'newer')
  release(note('held')); await stale
  expect(model.selected()?.slug).toBe('newer')
  expect(model.body()).toBe('body-newer')
})

it('keeps the editable prior document after a failed read and restores failed edits after retirement', async () => {
  const { model, stop } = await mount('failed-recovery')
  api.read = vi.fn(async () => ({ error: 'read failed' }))
  await model.open('task', 'missing')
  expect(model.selected()?.slug).toBe('scratchpad')
  api.write = vi.fn(async () => ({ error: 'offline' }))
  api.setTitle = vi.fn(async () => ({ error: 'offline title' }))
  model.onBodyInput('keep body'); model.onTitleInput('keep title')
  stop(); await tick()
  expect(api.write).toHaveBeenCalledTimes(1)
  expect(api.setTitle).toHaveBeenCalledTimes(1)
  const returned = await mount('failed-recovery')
  expect(returned.model.body()).toBe('keep body')
  expect(returned.model.noteTitle()).toBe('keep title')
  expect(returned.model.actionError()).toBe('offline title')
})

it('finishes one scratch creation after disposal without remembering or focusing a replacement', async () => {
  const { model, stop } = await mount('scratch-retirement')
  api.list = vi.fn(async () => [])
  // The public landing action uses the current list; start another model with the empty roster.
  stop()
  const client = new QueryClient()
  let scratch!: NotesModel
  const Model = () => { scratch = createNotesModel('scratch-empty', null); return null }
  const retire = render(() => <QueryClientProvider client={client}><Model /></QueryClientProvider>, document.createElement('div'))
  stops.push(() => { retire(); client.clear() })
  await tick()
  let release!: (value: { slug: string }) => void
  api.create = vi.fn(() => new Promise<{ slug: string }>((resolve) => { release = resolve }))
  scratch.onBodyInput('scratch text'); scratch.onTitleInput('scratch title')
  expect(api.create).toHaveBeenCalledTimes(1)
  const field = { focus: vi.fn(), select: vi.fn() } as unknown as HTMLInputElement
  scratch.titleRef(field); scratch.requestTitleFocus()
  retire(); setActiveNode('replacement')
  release({ slug: 'created-on-origin' }); await tick()
  expect(api.write).toHaveBeenCalledWith({ scope: 'task', taskId: 'scratch-empty' }, 'created-on-origin', 'scratch text')
  expect(api.setTitle).toHaveBeenCalledWith({ scope: 'task', taskId: 'scratch-empty' }, 'created-on-origin', 'scratch title')
  expect(notesSelectionFor('scratch-empty', null)).toBeUndefined()
  expect(field.focus).not.toHaveBeenCalled()
  expect(activeNodeId()).toBe('replacement')
  void model
})


it('does not adopt a held ordinary creation after a newer selection', async () => {
  const { model } = await mount('held-creation')
  let finish!: (value: { slug: string }) => void
  api.create = vi.fn(() => new Promise<{ slug: string }>((resolve) => { finish = resolve }))
  const creation = model.createIn('task')
  await model.open('task', 'newer')
  finish({ slug: 'created-late' })
  expect(await creation).toBe(false)
  expect(model.selected()?.slug).toBe('newer')
  expect(notesSelectionFor('held-creation', null)?.slug).toBe('newer')
})

it('keeps a failed virtual scratch creation and its error recoverable on return', async () => {
  const { model, stop } = await mount('scratch-failed', true)
  api.create = vi.fn(async () => { throw Error('scratch offline') })
  model.onBodyInput('recover virtual text')
  await tick()
  stop()
  const returned = await mount('scratch-failed', true)
  expect(returned.model.selected()?.virtual).toBe(true)
  expect(returned.model.body()).toBe('recover virtual text')
  expect(returned.model.actionError()).toBe('scratch offline')
  returned.model.onBodyInput('retry virtual text')
  await tick()
  expect(api.create).toHaveBeenCalledTimes(1)
  expect(api.write).toHaveBeenCalledWith({ scope: 'task', taskId: 'scratch-failed' }, 'created', 'retry virtual text')
})

it('executes confirmed deletion once after pending saves and retains a failed document', async () => {
  const { model } = await mount('confirmed-removal')
  await model.open('task', 'ordinary')
  let finish!: (value: { ok: boolean }) => void
  api.write = vi.fn(() => new Promise<{ ok: boolean }>(resolve => { finish = resolve }))
  api.remove = vi.fn(async () => ({ error: 'delete offline' }))
  model.onBodyInput('unsent body')
  const removal = model.remove('task', 'ordinary')
  await tick()
  expect(api.write).toHaveBeenCalledOnce()
  expect(api.remove).not.toHaveBeenCalled()
  finish({ ok: true })
  await removal
  expect(api.remove).toHaveBeenCalledExactlyOnceWith({ scope: 'task', taskId: 'confirmed-removal' }, 'ordinary')
  expect(model.selected()?.slug).toBe('ordinary')
  expect(model.body()).toBe('unsent body')
  expect(model.actionError()).toBe('delete offline')
})
