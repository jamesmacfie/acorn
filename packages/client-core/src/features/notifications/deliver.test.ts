// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  HOLD_MS, observeAttention, registerNoticeSink, resetDelivery,
  type DeliveryContext, type NoticeSink,
} from './deliver'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from './settings'
import type { AttentionState, Snapshot } from './attention'
import { _resetNotices, notices, type Notice } from './notifications'

const snap = (state: AttentionState, over: Partial<Snapshot> = {}): Snapshot =>
  ({ nodeId: 'n1', sessionId: 's1', taskId: 't1', title: 'claude', state, kind: 'interactive', ...over })

let focused = false
let settings: NotificationSettings = DEFAULT_NOTIFICATION_SETTINGS
const context: DeliveryContext = {
  focused: () => focused,
  activeTaskId: () => 't1',
  settings: () => settings,
  now: () => 1000,
}

let sunk: Notice[] = []
let dropSink: () => void
const sink: NoticeSink = (notice) => sunk.push(notice)

beforeEach(() => {
  vi.useFakeTimers()
  focused = false
  settings = DEFAULT_NOTIFICATION_SETTINGS
  sunk = []
  dropSink = registerNoticeSink(sink)
  resetDelivery()
  _resetNotices()
})
afterEach(() => {
  dropSink()
  vi.useRealTimers()
})

const settle = () => vi.advanceTimersByTime(HOLD_MS)

describe('the hold', () => {
  it('waits a second before anything lands', () => {
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    vi.advanceTimersByTime(HOLD_MS - 1)
    expect(notices()).toHaveLength(0)
    vi.advanceTimersByTime(1)
    expect(notices().map((n) => n.title)).toEqual(['claude needs you'])
  })

  // A permission that policy auto-approves goes working → blocked → working inside a few hundred
  // milliseconds. Waiting is not enough; the edge has to be asked about again.
  it('drops an edge the session has already moved off', () => {
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    vi.advanceTimersByTime(500)
    observeAttention([snap('working')], context)
    settle()
    expect(notices()).toHaveLength(0)
  })

  it('keeps at most one held edge per session, the newest', () => {
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    vi.advanceTimersByTime(500)
    observeAttention([snap('error')], context)
    settle()
    expect(notices().map((n) => n.kind)).toEqual(['agent-error'])
  })
})

describe('the seen rule', () => {
  it('an edge you watched lands read, and wakes nothing', () => {
    focused = true
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    settle()
    expect(notices()[0]).toMatchObject({ read: true, title: 'claude needs you' })
    expect(sunk).toEqual([])
  })

  it('an edge you missed lands unread, and wakes every channel', () => {
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    settle()
    expect(notices()[0].read).toBe(false)
    expect(sunk.map((n) => n.title)).toEqual(['claude needs you'])
  })

  it('another task being open is not watching this one', () => {
    focused = true
    observeAttention([snap('working', { taskId: 't2' })], context)
    observeAttention([snap('blocked', { taskId: 't2' })], context)
    settle()
    expect(notices()[0].read).toBe(false)
  })

  // Asked at release, not at arrival: coming back to the window during the hold means you saw it.
  it('asks when the edge lands, not when it arrives', () => {
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    focused = true
    settle()
    expect(notices()[0].read).toBe(true)
    expect(sunk).toEqual([])
  })
})

// Off means off: a silent row that still counted would contradict the switch.
it('a disabled event produces no row and no channel', () => {
  settings = { ...DEFAULT_NOTIFICATION_SETTINGS, events: { blocked: false, finished: true, error: true } }
  observeAttention([snap('working')], context)
  observeAttention([snap('blocked')], context)
  settle()
  expect(notices()).toHaveLength(0)
  expect(sunk).toEqual([])
})

it('points a PTY row at the terminal session and a managed row at the agent pane', () => {
  observeAttention([snap('working'), snap('working', { sessionId: 's2', kind: 'pty' })], context)
  observeAttention([snap('blocked'), snap('blocked', { sessionId: 's2', kind: 'pty' })], context)
  settle()
  expect(notices().map((n) => n.target?.kind).sort()).toEqual(['managed-agent', 'terminal-session'])
})
