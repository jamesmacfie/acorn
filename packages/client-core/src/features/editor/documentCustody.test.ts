import { Text } from '@codemirror/state'
import { describe, expect, it, vi } from 'vitest'
import { DocumentCustody, documentCustody } from './documentCustody'

let serial = 0
const owner = () => documentCustody(['node-a', 'test', String(++serial)], 'loaded')
const text = (value: string) => Text.of(value.split('\n'))

describe('document custody', () => {
  it('persists full recovery and keeps in-memory custody if storage rejects it', async () => {
    const stored = new Map<string, string>()
    const storage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value) },
      removeItem: (key: string) => { stored.delete(key) },
    }
    vi.stubGlobal('localStorage', storage)
    try {
      const address = ['node-a', 'storage', String(++serial)]
      const document = documentCustody(address, 'acknowledged')
      const release = document.retain()
      const full = 'full recovery\n😀\ufeff\ufffd'
      document.edit(text(full))
      document.viewState = { anchor: 3, head: 5, scrollTop: 42 }
      document.flushRecovery()
      const key = `acorn.document.recovery.${JSON.stringify(address)}`
      const reloaded = new DocumentCustody(key, 'external write')
      expect(reloaded.current.toString()).toBe(full)
      expect(reloaded.acknowledged.toString()).toBe('acknowledged')
      expect(reloaded.viewState).toEqual(document.viewState)
      storage.setItem = () => { throw new Error('quota') }
      document.edit(text(full + '\nlatest'))
      release()
      expect(document.error).toContain('Recovery storage is unavailable')
      expect(documentCustody(address, 'external')).toBe(document)
      expect(document.current.toString()).toBe(full + '\nlatest')
      await document.flush(async (value) => ({ text: value }))
    } finally { vi.unstubAllGlobals() }
  })

  it('joins repeated flushes and writes only the latest requested follow-up', async () => {
    const document = owner()
    const held: { text: string; resolve: (value: { text: string }) => void }[] = []
    const write = vi.fn((value: string) => new Promise<{ text: string }>((resolve) => held.push({ text: value, resolve })))
    document.edit(text('first'))
    const first = document.flush(write)
    expect(document.flush(write)).toBe(first)
    for (let i = 0; i < 40; i++) {
      document.edit(text(`latest ${i}`))
      expect(document.flush(write)).toBe(first)
    }
    expect(held).toHaveLength(1)
    held[0]!.resolve({ text: 'first' })
    await vi.waitFor(() => expect(held).toHaveLength(2))
    expect(held[1]!.text).toBe('latest 39')
    held[1]!.resolve({ text: 'latest 39' })
    await first
    expect(document.dirty).toBe(false)
    await document.flush(write)
    expect(write).toHaveBeenCalledTimes(2)
  })

  it('preserves failure across retirement and retries without retaining the old writer', async () => {
    const address = ['node-a', 'retired', String(++serial)]
    const document = documentCustody(address, 'loaded')
    const release = document.retain()
    document.edit(text('full dirty text\n😀'))
    const write = vi.fn().mockRejectedValueOnce(new Error('veto')).mockResolvedValue({ text: 'full dirty text\n😀' })
    await expect(document.flush(write)).rejects.toThrow('veto')
    release()
    const reopened = documentCustody(address, 'external')
    expect(reopened).toBe(document)
    expect(reopened.current.toString()).toBe('full dirty text\n😀')
    await reopened.flush(write)
    expect(reopened.dirty).toBe(false)
  })

  it('acknowledges formatter output while a later human edit wins', async () => {
    const document = owner()
    document.edit(text('unformatted'))
    let resolve!: (value: { text: string; revision: string }) => void
    const saving = document.flush(() => new Promise((done) => { resolve = done }))
    document.edit(text('later edit'))
    resolve({ text: 'formatted', revision: 'exact-file-revision' })
    await saving
    expect(document.current.toString()).toBe('later edit')
    expect(document.acknowledged.toString()).toBe('formatted')
    expect(document.acknowledgedRevision).toBe('exact-file-revision')
    expect(document.dirty).toBe(true)
  })

  it('applies formatting when the submitted edit is still current', async () => {
    const document = owner()
    document.edit(text('unformatted'))
    await document.flush(async () => ({ text: 'formatted' }))
    expect(document.current.toString()).toBe('formatted')
    expect(document.dirty).toBe(false)
  })

  it('writes an undo back to acknowledged content after a held write lands', async () => {
    const document = owner()
    let resolve!: (value: { text: string }) => void
    const write = vi.fn().mockImplementationOnce(() => new Promise((done) => { resolve = done }))
      .mockResolvedValue({ text: 'loaded' })
    document.edit(text('edit'))
    const saving = document.flush(write)
    document.edit(text('loaded'))
    expect(document.dirty).toBe(false)
    const undoFlush = document.flush(write)
    resolve({ text: 'edit' })
    await Promise.all([saving, undoFlush])
    expect(write.mock.calls.map(([value]) => value)).toEqual(['edit', 'loaded'])
    expect(document.dirty).toBe(false)
  })

  it('admits independent documents independently and keeps Node addresses separate', async () => {
    const a = documentCustody(['node-a', 'task', String(++serial)], 'loaded')
    const b = documentCustody(['node-b', 'task', String(serial)], 'loaded')
    a.edit(text('a'))
    b.edit(text('b'))
    let resolve!: (value: {}) => void
    const saving = a.flush(() => new Promise((done) => { resolve = done }))
    await b.flush(async () => ({}))
    expect(b.dirty).toBe(false)
    expect(a.dirty).toBe(true)
    resolve({})
    await saving
  })
})
