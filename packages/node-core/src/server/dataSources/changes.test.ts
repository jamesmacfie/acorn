import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DataSourceRegistration } from '@acorn/protocol/dataSources.ts'
import { onWsBroadcast } from '../transport/wsHub'
import { dataSourceChanged } from './changes'
import { clearDataSources, registerDataSource } from './registry'

const source = (pluginId: string, sourceId: string, inputs?: DataSourceRegistration['inputs']) =>
  registerDataSource(pluginId, {
    sourceId,
    name: sourceId,
    singular: sourceId,
    plural: sourceId,
    identityScope: 'Stable',
    handler: `/v1/p/${pluginId}/${sourceId}`,
    ...(inputs ? { inputs } : {}),
  })

describe('dataSourceChanged', () => {
  let heard: unknown[]
  let off: () => void
  let warn: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.useFakeTimers()
    heard = []
    off = onWsBroadcast((frame) => {
      if (frame.channel === 'data-source:changed') heard.push(frame)
    })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    source('linear', 'issues')
    source('github', 'pull-requests')
    source('readiness', 'readiness', { issues: { source: 'linear:issues', label: 'Issues' } })
    source('rollup', 'rollup', { readiness: { source: 'readiness:readiness', label: 'Readiness' } })
    source('deep', 'deep', { rollup: { source: 'rollup:rollup', label: 'Rollup' } })
  })
  afterEach(() => {
    off()
    for (const pluginId of ['linear', 'github', 'readiness', 'rollup', 'deep']) clearDataSources(pluginId)
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('refuses a source the caller does not own, logging it once', () => {
    dataSourceChanged('github', 'linear:issues')
    dataSourceChanged('github', 'linear:issues')
    dataSourceChanged('github', 'issues')
    vi.advanceTimersByTime(1_000)
    expect(heard).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('publishes ten calls within a second as one event, keeping a shared account', () => {
    for (let i = 0; i < 10; i++) dataSourceChanged('github', 'pull-requests', { connectionId: 'conn-1' })
    vi.advanceTimersByTime(999)
    expect(heard).toEqual([])
    vi.advanceTimersByTime(1)
    expect(heard).toEqual([
      { channel: 'data-source:changed', pluginId: 'github', sourceId: 'pull-requests', connectionId: 'conn-1' },
    ])

    dataSourceChanged('github', 'pull-requests', { connectionId: 'conn-1' })
    dataSourceChanged('github', 'pull-requests', { connectionId: 'conn-2' })
    vi.advanceTimersByTime(1_000)
    expect(heard[1]).toEqual({ channel: 'data-source:changed', pluginId: 'github', sourceId: 'pull-requests' })
  })

  it('publishes for the derived sources that read a changed source, two levels deep', () => {
    dataSourceChanged('linear', 'issues', { connectionId: 'conn-1' })
    vi.advanceTimersByTime(1_000)
    expect(heard).toEqual([
      { channel: 'data-source:changed', pluginId: 'linear', sourceId: 'issues', connectionId: 'conn-1' },
      { channel: 'data-source:changed', pluginId: 'readiness', sourceId: 'readiness' },
      { channel: 'data-source:changed', pluginId: 'rollup', sourceId: 'rollup' },
    ])
  })
})
