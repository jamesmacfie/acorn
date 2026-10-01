import { afterEach, expect, it, vi } from 'vitest'
import { NoteDraft, noteDraft } from './noteDrafts'
import { notesApi, type NotesApi } from './notesClient'
const location = { scope: 'task', taskId: 'same' } as const
const api = (): NotesApi => ({ ...notesApi(null), write: vi.fn(async () => ({ ok: true })), setTitle: vi.fn(async () => ({ ok: true })) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('coalesces held saves to the latest follow-up and acknowledges only the sent local revision', async () => {
  const target = api()
  let release!: (result: { ok: boolean }) => void
  const bodies: string[] = []
  target.write = vi.fn((_location, _slug, body) => {
    bodies.push(body)
    return bodies.length === 1 ? new Promise<{ ok: boolean }>((resolve) => { release = resolve }) : Promise.resolve({ ok: true })
  })
  const draft = new NoteDraft('held', location, 'note')
  draft.edit('body', 'first')
  const saving = draft.save(target)
  await Promise.resolve()
  for (let i = 0; i < 100; i++) { draft.edit('body', `latest-${i}`); expect(draft.save(target)).toBe(saving) }
  draft.edit('title', 'title')
  expect(draft.dirty).toBe(true)
  release({ ok: true })
  await saving
  expect(bodies).toEqual(['first', 'latest-99'])
  expect(target.setTitle).toHaveBeenCalledTimes(1)
  expect(draft.dirty).toBe(false)
})

it('retains failed body/title and orders inclusion behind the active write', async () => {
  const target = api()
  const order: string[] = []
  target.write = async () => { order.push('body'); throw Error('offline') }
  target.setTitle = async () => { order.push('title'); return { error: 'failed title' } }
  const draft = new NoteDraft('failed', location, 'note')
  draft.edit('body', 'body'); draft.edit('title', 'title')
  const saving = draft.save(target)
  const included = draft.run(async () => { order.push('included') })
  await Promise.all([saving, included])
  expect(order).toEqual(['body', 'title', 'included'])
  expect(draft.body).toBe('body'); expect(draft.title).toBe('title')
  expect(draft.error).toBe('failed title')
})

it('partitions equal task/document IDs by Node and preserves full large drafts with bounded persistence', () => {
  vi.useFakeTimers()
  const a = noteDraft('a-recovery', location, 'same')
  const b = noteDraft('b-recovery', location, 'same')
  const storage = { getItem: () => null, setItem: vi.fn(), removeItem: vi.fn() }
  vi.stubGlobal('localStorage', storage)
  const large = '🌰'.repeat(150_000)
  const stringify = vi.spyOn(JSON, 'stringify')
  for (let i = 0; i < 100; i++) a.edit('body', large + i)
  expect(stringify).not.toHaveBeenCalled()
  expect(storage.setItem).not.toHaveBeenCalled()
  expect(b.body).toBeUndefined()
  vi.advanceTimersByTime(250)
  expect(stringify).toHaveBeenCalledTimes(1)
  expect(storage.setItem).toHaveBeenCalledTimes(1)
  expect(a.body).toBe(large + 99)
  a.edit('title', 'retiring title'); a.flushRecovery()
  expect(stringify).toHaveBeenCalledTimes(2)
  expect(storage.setItem).toHaveBeenCalledTimes(2)
  stringify.mockRestore()
  a.discard(); b.discard()
})
