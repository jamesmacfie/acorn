import { describe, expect, it, vi } from 'vitest'
import { archiveInBackground, type ArchiveRun } from './task'

describe('archiveInBackground', () => {
  it('waits while the archive runs and answers its outcome', async () => {
    const waits: ArchiveRun[] = [{ state: 'running' }, { state: 'finished', result: { ok: true } }]
    const legacy = vi.fn()
    const result = await archiveInBackground({
      start: async () => ({ state: 'running' }),
      wait: async () => waits.shift()!,
      legacy,
    })
    expect(result).toEqual({ ok: true })
    expect(waits).toEqual([])
    expect(legacy).not.toHaveBeenCalled()
  })

  it('archives in one request when the Node has no background routes', async () => {
    const result = await archiveInBackground({
      start: async () => null,
      wait: async () => ({ state: 'none' }),
      legacy: async () => ({ ok: false, reason: 'Stop 1 running session first.' }),
    })
    expect(result).toEqual({ ok: false, reason: 'Stop 1 running session first.' })
  })

  it('reports an archive the Node lost, such as after a restart, as not done', async () => {
    const result = await archiveInBackground({
      start: async () => ({ state: 'running' }),
      wait: async () => ({ state: 'none' }),
      legacy: async () => ({ ok: true }),
    })
    expect(result).toMatchObject({ ok: false, reason: expect.stringContaining('lost track') })
  })
})
