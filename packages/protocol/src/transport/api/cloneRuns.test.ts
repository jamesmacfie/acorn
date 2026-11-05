import { describe, expect, it } from 'vitest'
import { cloneOutcome, type CloneRun } from './cloneRuns'

describe('cloneOutcome', () => {
  it('waits while the clone runs and answers its outcome', async () => {
    const waits: CloneRun[] = [
      { state: 'running', elapsedMs: 20_000 },
      { state: 'finished', result: { ok: true, projectId: 'p' } },
    ]
    expect(await cloneOutcome(async () => waits.shift()!)).toEqual({ ok: true, projectId: 'p' })
    expect(waits).toEqual([])
  })

  it('reports a clone the Node lost, such as after a restart, as failed', async () => {
    expect(await cloneOutcome(async () => ({ state: 'none' }))).toMatchObject({
      ok: false,
      error: expect.stringContaining('lost track'),
    })
  })
})
