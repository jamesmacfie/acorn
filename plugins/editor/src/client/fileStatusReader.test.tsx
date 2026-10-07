import { createRoot } from 'solid-js'
import { expect, it, vi } from 'vitest'
import { createFileStatusReader } from './fileStatusReader'
import type { EditorFileStatusSnapshot } from '../contract/fileStatus'

const changed: EditorFileStatusSnapshot = { kind: 'ready', changes: [{ path: 'a.ts', status: 'modified', staged: false }] }
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

it('retains a useful snapshot after a transient failure and clears it when the provider disappears', async () => {
  const api = { fileStatus: vi.fn()
    .mockResolvedValueOnce(changed)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ kind: 'unavailable' }) }
  const stop = createRoot((dispose) => {
    const reader = createFileStatusReader(api, 'task', () => true)
    return { reader, dispose }
  })
  stop.reader.refresh(); await settle()
  expect(stop.reader.projection().files.get('a.ts')?.letter).toBe('M')
  stop.reader.refresh(); await settle()
  expect(stop.reader.stale()).toBe(true)
  expect(stop.reader.projection().files.get('a.ts')?.letter).toBe('M')
  stop.reader.refresh(); await settle()
  expect(stop.reader.projection().files.size).toBe(0)
  expect(stop.reader.stale()).toBe(false)
  stop.reader.stop(); stop.dispose()
})

it('coalesces bursts and rejects a late response after task retirement', async () => {
  let finish!: (value: EditorFileStatusSnapshot) => void
  const api = { fileStatus: vi.fn().mockImplementationOnce(() => new Promise<EditorFileStatusSnapshot>((resolve) => { finish = resolve }))
    .mockResolvedValue({ kind: 'unavailable' }) }
  const { reader, dispose } = createRoot((dispose) => ({ reader: createFileStatusReader(api, 'task', () => true), dispose }))
  reader.refresh(); reader.refresh(); reader.refresh()
  await settle()
  expect(api.fileStatus).toHaveBeenCalledTimes(1)
  finish(changed); await settle()
  expect(api.fileStatus).toHaveBeenCalledTimes(2)
  expect(reader.projection().files.size).toBe(0)
  reader.stop(); dispose()
})

it('clears provider marks on roster change and ignores the old in-flight result', async () => {
  let finish!: (value: EditorFileStatusSnapshot) => void
  const api = { fileStatus: vi.fn().mockResolvedValueOnce(changed)
    .mockImplementationOnce(() => new Promise<EditorFileStatusSnapshot>((resolve) => { finish = resolve }))
    .mockResolvedValueOnce({ kind: 'unavailable' }) }
  const { reader, dispose } = createRoot((dispose) => ({ reader: createFileStatusReader(api, 'task', () => true), dispose }))
  reader.refresh(); await settle()
  expect(reader.projection().files.size).toBe(1)
  reader.refresh(); await settle()
  reader.providerChanged()
  expect(reader.projection().files.size).toBe(0)
  finish(changed); await settle()
  expect(reader.projection().files.size).toBe(0)
  expect(api.fileStatus).toHaveBeenCalledTimes(3)
  reader.stop(); dispose()
})

it('does not apply a response after its Node stops owning the pane', async () => {
  let finish!: (value: EditorFileStatusSnapshot) => void
  let current = true
  const api = { fileStatus: () => new Promise<EditorFileStatusSnapshot>((resolve) => { finish = resolve }) }
  const { reader, dispose } = createRoot((dispose) => ({ reader: createFileStatusReader(api, 'task', () => current), dispose }))
  reader.refresh(); current = false; finish(changed); await settle()
  expect(reader.projection().files.size).toBe(0)
  reader.stop(); dispose()
})

it('projects 10,000 status entries once for repeated visible-row lookups', async () => {
  const changes = Array.from({ length: 10_000 }, (_, index) => ({ path: `src/${index}.txt`, status: 'untracked' as const, staged: false }))
  const api = { fileStatus: vi.fn(async () => ({ kind: 'ready' as const, changes })) }
  const { reader, dispose } = createRoot((dispose) => ({ reader: createFileStatusReader(api, 'task', () => true), dispose }))
  reader.refresh(); await settle()
  const first = reader.projection()
  const started = performance.now()
  for (let index = 0; index < 500; index++) expect(reader.projection().files.get(`src/${index}.txt`)?.letter).toBe('?')
  expect(reader.projection()).toBe(first)
  expect(first.folders.get('src')?.count).toBe(10_000)
  expect(api.fileStatus).toHaveBeenCalledTimes(1)
  console.info(`10,000-path projection: ${Math.round(performance.now() - started)} ms for 500 lookups`)
  reader.stop(); dispose()
})
