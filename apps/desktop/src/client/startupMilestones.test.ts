import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TelemetryRecord, TelemetrySpan } from '@acorn/protocol/telemetry.ts'
import {
  _resetClientTelemetry,
  flushTelemetry,
  setTelemetryEnabled,
  startClientTelemetry,
} from '@acorn/client-core/infra/telemetry/emitter.ts'
import { featureUsable, openFeature } from '@acorn/client-core/infra/telemetry'
import { startupTraceId } from './boot'
import {
  _resetStartupMilestones,
  claimStartupAccount,
  emitStartupMilestones,
  markFirstFrame,
  markNodeWaited,
  markShellDrawn,
} from './startupMilestones'

let posted: TelemetryRecord[]

const spans = async (): Promise<TelemetrySpan[]> => {
  await flushTelemetry()
  return posted.filter(
    (record): record is TelemetrySpan => record.kind === 'span' && record.name.startsWith('renderer.startup'),
  )
}
const named = (all: TelemetrySpan[], name: string) => all.filter((span) => span.name === name)

/** The consent effect in App.tsx: the emitter's switch, then this module's. */
const consent = (on: boolean) => {
  setTelemetryEnabled(on)
  if (on) emitStartupMilestones()
}

/** Lets the deferred settlement in `restored()` run, without reaching an opening's timeout. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout'] })
  posted = []
  _resetStartupMilestones()
  startClientTelemetry({ runtime: 'renderer', post: async (records) => void posted.push(...records) })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  _resetClientTelemetry()
})

it('records each milestone once and emits them when consent arrives later, in the launch trace', async () => {
  markFirstFrame()
  markFirstFrame()
  const account = claimStartupAccount('node-a')
  account.restored()
  account.restored()
  await settle()
  expect(await spans()).toEqual([])

  consent(true)
  const all = await spans()
  expect(all.map((span) => span.name).sort()).toEqual([
    'renderer.startup.first_frame',
    'renderer.startup.phase',
    'renderer.startup.phase',
    'renderer.startup.restored',
    'renderer.startup.usable',
  ])
  for (const span of all) expect(span.traceId).toBe(startupTraceId)
  const [frame] = named(all, 'renderer.startup.first_frame')
  // No paint entry outside a browser, so the frame callback stands in and says so.
  expect(frame!.attrs).toMatchObject({ method: 'frame', proxy: true, visibility: 'visible' })
  expect(frame!.start).toBe(performance.timeOrigin)
  // Nothing was open at the landing, which is the empty or no-project screen.
  const [usable] = named(all, 'renderer.startup.usable')
  expect(usable!.attrs).toMatchObject({ features: 0, outcome: 'usable', proxy: false })
  expect(named(all, 'renderer.startup.phase').map((span) => span.parentSpanId)).toEqual([
    usable!.spanId,
    usable!.spanId,
  ])

  consent(false)
  consent(true)
  markFirstFrame()
  expect(await spans()).toHaveLength(all.length)
})

it('says on every milestone that the launch waited for a Node that could not answer at tree built', async () => {
  markShellDrawn()
  markNodeWaited(true)
  markNodeWaited(false)
  markFirstFrame()
  claimStartupAccount('node-a').restored()
  await settle()
  consent(true)
  const milestones = (await spans()).filter((span) => span.name !== 'renderer.startup.phase')
  expect(milestones.map((span) => span.name).sort()).toEqual([
    'renderer.startup.first_frame',
    'renderer.startup.restored',
    'renderer.startup.shell',
    'renderer.startup.usable',
  ])
  for (const span of milestones) expect(span.attrs['node.waited']).toBe(true)
})

it('waits for every feature open at the landing before the usable milestone', async () => {
  consent(true)
  const account = claimStartupAccount('node-a')
  openFeature('agents', 'agents', { kind: 'pane', reportsUsable: true })
  account.restored()
  await settle()
  expect(named(await spans(), 'renderer.startup.usable')).toEqual([])
  featureUsable('agents', 'offline')
  await settle()
  const [usable] = named(await spans(), 'renderer.startup.usable')
  expect(usable!.attrs).toMatchObject({ features: 1, outcome: 'usable' })
})

it('keeps the numbers local while the switch is off, then emits each once when it turns on', async () => {
  consent(true)
  consent(false)
  markFirstFrame()
  claimStartupAccount('node-a').restored()
  await settle()
  expect(await spans()).toEqual([])
  consent(true)
  const names = (await spans())
    .map((span) => span.name)
    .filter((name) => name !== 'renderer.startup.phase')
    .sort()
  expect(names).toEqual(['renderer.startup.first_frame', 'renderer.startup.restored', 'renderer.startup.usable'])
  consent(false)
  consent(true)
  expect(await spans()).toHaveLength(names.length + 2)
})

it('belongs to the first Node that restores, and is dropped on a switch to another Node', async () => {
  // A first launch mounts under the placeholder cache, and a remembered Node can be re-homed from.
  claimStartupAccount(null).restored()
  claimStartupAccount('remembered')
  const first = claimStartupAccount('node-a')
  first.restored()
  // A remount for the same Node shares the account and records nothing twice.
  claimStartupAccount('node-a').restored()
  await settle()
  claimStartupAccount('node-b').restored()
  await settle()
  consent(true)
  expect(await spans()).toEqual([])
})

it('reports the restore of a Node the window re-homed to before restoring', async () => {
  claimStartupAccount('remembered')
  claimStartupAccount('node-a').restored()
  await settle()
  consent(true)
  expect(named(await spans(), 'renderer.startup.restored')).toHaveLength(1)
})

it('labels a milestone reached after the window was hidden', async () => {
  const listeners: (() => void)[] = []
  const fakeDocument = {
    hidden: false,
    addEventListener: (_: string, listener: () => void) => listeners.push(listener),
  }
  vi.stubGlobal('document', fakeDocument)
  _resetStartupMilestones()
  const account = claimStartupAccount('node-a')
  account.restored()
  const restoredAt = performance.now()
  while (performance.now() === restoredAt) {
    /* the hide has to come strictly after the restore */
  }
  fakeDocument.hidden = true
  for (const listener of listeners) listener()
  markFirstFrame()
  await settle()
  consent(true)
  const all = await spans()
  expect(named(all, 'renderer.startup.restored')[0]!.attrs.visibility).toBe('visible')
  expect(named(all, 'renderer.startup.first_frame')[0]!.attrs.visibility).toBe('hidden')
})

it('records the shell once, apart from the first frame and the restore', async () => {
  consent(true)
  markFirstFrame()
  markShellDrawn()
  markShellDrawn()
  const shell = named(await spans(), 'renderer.startup.shell')
  expect(shell).toHaveLength(1)
  expect(shell[0]!.traceId).toBe(startupTraceId)
  expect(named(await spans(), 'renderer.startup.restored')).toEqual([])
})

it('ends the usable milestone on a failure the person can act on, and still records a later restore', async () => {
  consent(true)
  const account = claimStartupAccount('node-a')
  account.stopped('registration', 'error')
  account.stopped('registration', 'error')
  const [usable] = named(await spans(), 'renderer.startup.usable')
  expect(usable!.status).toBe('error')
  expect(usable!.attrs).toMatchObject({ outcome: 'error', 'startup.step': 'registration', features: 0 })

  // Try again worked.
  account.restored()
  await settle()
  const all = await spans()
  expect(named(all, 'renderer.startup.restored')).toHaveLength(1)
  expect(named(all, 'renderer.startup.usable')).toHaveLength(1)
})

it('does not end the usable milestone for a stop after the restore', async () => {
  consent(true)
  const account = claimStartupAccount('node-a')
  account.restored()
  account.stopped('offline', 'offline')
  await settle()
  expect(named(await spans(), 'renderer.startup.usable')[0]!.attrs.outcome).toBe('usable')
})
