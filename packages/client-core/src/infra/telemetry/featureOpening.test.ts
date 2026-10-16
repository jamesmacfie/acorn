import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TelemetryRecord } from '@acorn/protocol/telemetry.ts'
import { _resetClientTelemetry, flushTelemetry, setTelemetryEnabled, startClientTelemetry } from './emitter'
import {
  _resetFeatureOpenings,
  featureMounted,
  featureUsable,
  MAX_PENDING_OPENINGS,
  OPENING_TIMEOUT_MS,
  openFeature,
  whenOpenFeaturesSettle,
} from './featureOpening'

let posted: TelemetryRecord[]

beforeEach(() => {
  _resetClientTelemetry()
  _resetFeatureOpenings()
  posted = []
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
  setTelemetryEnabled(true)
})
afterEach(() => {
  _resetFeatureOpenings()
  _resetClientTelemetry()
  vi.useRealTimers()
})

const openings = async () => {
  await flushTelemetry()
  return posted.filter((record) => record.kind === 'span' && record.name === 'ui.feature.open')
}

it('ends one span when the feature reports, and labels only the first opening as first', async () => {
  openFeature('editor', 'editor', { kind: 'pane', reportsUsable: true })
  featureUsable('editor', 'content', { cached: false })
  featureUsable('editor')
  openFeature('editor', 'editor', { kind: 'pane', reportsUsable: true })
  featureUsable('editor', 'empty')
  const spans = await openings()
  expect(spans.map((span) => span.attrs)).toMatchObject([
    {
      'feature.id': 'editor',
      'feature.kind': 'pane',
      first: true,
      outcome: 'usable',
      state: 'content',
      cached: false,
      owner: 'editor',
    },
    { 'feature.id': 'editor', first: false, state: 'empty' },
  ])
})

it('ignores the mount of a feature that reports for itself, and labels a mount-closed one as a proxy', async () => {
  openFeature('changes', 'changes', { kind: 'pane', reportsUsable: true })
  featureMounted('changes')
  openFeature('pr', 'github', { kind: 'pane', reportsUsable: false })
  featureMounted('pr')
  expect((await openings()).map((span) => span.attrs)).toMatchObject([{ 'feature.id': 'pr', proxy: 'mount' }])
  featureUsable('changes', 'offline')
  expect((await openings()).at(-1)?.attrs).toMatchObject({ 'feature.id': 'changes', state: 'offline' })
})

it('drops a cancelled opening and reports a timed-out one as an error', async () => {
  vi.useFakeTimers()
  const close = openFeature('agent', 'agents', { kind: 'pane', reportsUsable: true })
  close()
  featureUsable('agent')
  openFeature('settings', 'core', { kind: 'settings', reportsUsable: true })
  vi.advanceTimersByTime(OPENING_TIMEOUT_MS)
  const spans = await openings()
  expect(spans).toHaveLength(1)
  expect(spans[0]).toMatchObject({ status: 'error', attrs: { 'feature.id': 'settings', outcome: 'timeout' } })
})

it('caps a timeout that fired late at the deadline and says it was late', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  let now = 1_000
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now)
  openFeature('settings', 'core', { kind: 'settings', reportsUsable: true })
  // The Mac slept, so the timer fires a minute after it was due.
  now += OPENING_TIMEOUT_MS + 60_000
  vi.advanceTimersByTime(OPENING_TIMEOUT_MS)
  clock.mockRestore()
  const [span] = await openings()
  expect(span).toMatchObject({ durationMs: OPENING_TIMEOUT_MS, attrs: { outcome: 'timeout', late: true } })
})

it('holds at most a bounded number of pending records', async () => {
  const settled = whenOpenFeaturesSettle()
  for (let index = 0; index <= MAX_PENDING_OPENINGS; index += 1)
    openFeature(`pane-${index}`, 'core', { kind: 'pane', reportsUsable: true })
  for (let index = 0; index <= MAX_PENDING_OPENINGS; index += 1) featureUsable(`pane-${index}`)
  // The oldest was evicted before it could report, so only the rest produce spans.
  expect(await openings()).toHaveLength(MAX_PENDING_OPENINGS)
  await expect(settled).resolves.toEqual({ features: 0, proxy: false, outcome: 'usable' })
})

it('settles the startup account once every open feature has, carrying the worst outcome', async () => {
  openFeature('agent', 'agents', { kind: 'pane', reportsUsable: true })
  openFeature('pr', 'github', { kind: 'pane', reportsUsable: false })
  const settled = whenOpenFeaturesSettle()
  // A feature opened after the snapshot does not hold the account.
  openFeature('editor', 'editor', { kind: 'pane', reportsUsable: true })
  featureMounted('pr')
  const close = openFeature('agent', 'agents', { kind: 'pane', reportsUsable: true })
  close()
  await expect(settled).resolves.toEqual({ features: 2, proxy: true, outcome: 'cancelled' })
})

it('still tracks openings with telemetry off, so the startup account can settle, but builds no span', async () => {
  setTelemetryEnabled(false)
  openFeature('agent', 'agents', { kind: 'pane', reportsUsable: true })
  const settled = whenOpenFeaturesSettle()
  featureUsable('agent', 'error')
  await expect(settled).resolves.toMatchObject({ features: 1, outcome: 'usable' })
  setTelemetryEnabled(true)
  expect(await openings()).toEqual([])
})
