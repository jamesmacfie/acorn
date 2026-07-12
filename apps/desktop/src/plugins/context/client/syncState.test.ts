import { describe, expect, it } from 'vitest'
import { evictSyncState, recordSync, syncStatus } from './syncState'

describe('context sync staleness', () => {
  it('reports never, synced, and stale-with-change-count', () => {
    const sent = { notes: 'A', pr: 'B' }
    expect(syncStatus('s1', sent).kind).toBe('never')

    recordSync('s1', 'task1', sent)
    expect(syncStatus('s1', sent)).toMatchObject({ kind: 'synced' })

    // one section body changed, one section removed, one section added → 3 changes
    const changed = syncStatus('s1', { notes: 'A2', memory: 'C' })
    expect(changed.kind).toBe('stale')
    expect(changed.kind === 'stale' && changed.changes).toBe(3)
  })

  it('evicts every session record for a task', () => {
    recordSync('s2', 'task2', { notes: 'x' })
    recordSync('s3', 'task2', { notes: 'y' })
    evictSyncState('task2')
    expect(syncStatus('s2', {}).kind).toBe('never')
    expect(syncStatus('s3', {}).kind).toBe('never')
  })
})
