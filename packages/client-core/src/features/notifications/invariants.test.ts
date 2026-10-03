// @vitest-environment node
//
// The eight invariants in docs/notifications/gate.md § Invariants, as properties over generated
// sequences rather than as tables. Each part of the model already has its own tests with worked
// examples; this file is about the whole, so that no adapter or sink added later can make an edge
// you watched noisy, or the pill disagree with what the bell holds.
//
// Fixed seeds and a two-line generator, not fast-check. Nothing in the repo depends on a
// property-testing library, and a state machine with five states and four kinds is small enough to
// walk exhaustively where it matters and sample where it does not.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type AttentionState, type EdgeKind, type Snapshot } from './attention'
import { HOLD_MS, observeAttention, registerNoticeSink, resetDelivery, type DeliveryContext } from './deliver'
import { _resetNotices, notices, unreadCount, type Notice } from './notifications'
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from './settings'

const STATES: AttentionState[] = ['working', 'blocked', 'finished', 'error', 'idle']
const FINISH_POLICIES = [true, false] as const
const EVENTS = ['blocked', 'finished', 'error'] as const

// A linear congruential generator, so a failure names a seed you can put back.
const rng = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296)
const pick = <T>(random: () => number, from: readonly T[]): T => from[Math.floor(random() * from.length)]

const snap = (state: AttentionState, over: Partial<Snapshot> = {}): Snapshot =>
  ({ nodeId: 'n1', sessionId: 's1', taskId: 't1', title: 'claude', state, sourceId: 'agents', notifyOnFinish: true, target: { kind: 'managed-agent', resourceId: 's1' }, ...over })

// The three edges, transcribed from docs/notifications/states-and-edges.md § Three edges rather than derived from the
// code, so this is a second opinion and not an echo.
const modelSays = (from: AttentionState, to: AttentionState, notifyOnFinish: boolean): EdgeKind | null =>
  from === to ? null
    : to === 'blocked' ? 'agent-needs-input'
      : to === 'error' ? 'agent-error'
        : to === 'finished' && from === 'working' && notifyOnFinish ? 'agent-completed'
          : null

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

beforeEach(() => {
  vi.useFakeTimers()
  dropSink = registerNoticeSink((notice) => sunk.push(notice))
})
afterEach(() => {
  dropSink()
  vi.useRealTimers()
})

/** One generated case starts from nothing: the gate's snapshot map and the ring are module state. */
const start = (over: Partial<{ focused: boolean; settings: NotificationSettings }> = {}) => {
  resetDelivery()
  _resetNotices()
  sunk = []
  focused = over.focused ?? false
  settings = over.settings ?? DEFAULT_NOTIFICATION_SETTINGS
}

const observe = (...snapshots: Snapshot[]) => observeAttention(snapshots, context)
const settle = () => vi.advanceTimersByTime(HOLD_MS)

describe('the model holds over generated sequences (docs/notifications/gate.md § Invariants)', () => {
  it('1. standing still is never news', () => {
    const random = rng(1)
    for (let run = 0; run < 200; run++) {
      const state = pick(random, STATES)
      const notifyOnFinish = pick(random, FINISH_POLICIES)
      start()
      observe(snap(state, { notifyOnFinish }))
      settle()
      const before = notices().length
      for (let again = 0; again < 3; again++) {
        observe(snap(state, { notifyOnFinish }))
        settle()
      }
      expect(notices()).toHaveLength(before)
    }
  })

  it('2. a first sighting is never news, whatever it walked in as', () => {
    for (const state of STATES)
      for (const notifyOnFinish of FINISH_POLICIES) {
        start()
        observe(snap(state, { notifyOnFinish }))
        settle()
        expect(notices()).toEqual([])
        expect(sunk).toEqual([])
      }
  })

  it('3. over every pair of the five states, the gate says what the model says', () => {
    for (const from of STATES)
      for (const to of STATES)
        for (const notifyOnFinish of FINISH_POLICIES) {
          start()
          observe(snap(from, { notifyOnFinish }))
          settle()
          observe(snap(to, { notifyOnFinish }))
          settle()
          expect(notices().map((n) => n.kind)).toEqual([modelSays(from, to, notifyOnFinish)].filter(Boolean))
        }
  })

  it('4. an edge you watched lands read and wakes nothing', () => {
    const random = rng(4)
    for (let run = 0; run < 200; run++) {
      const from = pick(random, STATES)
      const to = pick(random, STATES)
      const notifyOnFinish = pick(random, FINISH_POLICIES)
      start({ focused: true })
      observe(snap(from, { notifyOnFinish }))
      settle()
      observe(snap(to, { notifyOnFinish }))
      settle()
      expect(notices().every((n) => n.read)).toBe(true)
      expect(sunk).toEqual([])
      expect(unreadCount()).toBe(0)
    }
  })

  it('5. an edge the session moves off inside the hold is dropped', () => {
    const random = rng(5)
    for (const from of STATES)
      for (const to of STATES) {
        if (!modelSays(from, to, true)) continue
        const away = pick(random, STATES.filter((s) => s !== to))
        start()
        observe(snap(from))
        settle()
        observe(snap(to))
        vi.advanceTimersByTime(HOLD_MS - 1)
        observe(snap(away))
        settle()
        settle()
        // Only the second edge, if the move was itself news. Never the one that stopped being true.
        expect(notices().map((n) => n.kind)).toEqual([modelSays(to, away, true)].filter(Boolean))
      }
  })

  it('6. the pill counts exactly the edges you missed', () => {
    // The pill the bell draws is `unreadCount() + inbox rows`, and `trackBadge` hands the app icon
    // that same accessor — badge.test.tsx owns the effect, attentionInbox.test.ts owns the rows.
    // What a generated sequence can add is the other half: that the gate never puts a row in the
    // ring the pill does not account for, and that a seen edge never moves it.
    const random = rng(6)
    for (let run = 0; run < 100; run++) {
      start()
      let missed = 0
      let state = pick(random, STATES)
      const notifyOnFinish = pick(random, FINISH_POLICIES)
      observe(snap(state, { notifyOnFinish }))
      settle()
      for (let step = 0; step < 12; step++) {
        const next = pick(random, STATES)
        focused = random() < 0.5
        observe(snap(next, { notifyOnFinish }))
        settle()
        if (modelSays(state, next, notifyOnFinish) && !focused) missed++
        state = next
      }
      expect(unreadCount()).toBe(missed)
      expect(notices().filter((n) => !n.read)).toHaveLength(missed)
      expect(sunk).toHaveLength(missed)
    }
  })

  it('7. an event switched off produces no row and no channel', () => {
    const random = rng(7)
    for (const off of EVENTS)
      for (let run = 0; run < 60; run++) {
        const from = pick(random, STATES)
        const to = pick(random, STATES)
        const notifyOnFinish = pick(random, FINISH_POLICIES)
        start({ settings: { ...DEFAULT_NOTIFICATION_SETTINGS, events: { ...DEFAULT_NOTIFICATION_SETTINGS.events, [off]: false } } })
        observe(snap(from, { notifyOnFinish }))
        settle()
        observe(snap(to, { notifyOnFinish }))
        settle()
        const silenced: Record<typeof off, EdgeKind> =
          { blocked: 'agent-needs-input', finished: 'agent-completed', error: 'agent-error' }
        expect(notices().map((n) => n.kind)).not.toContain(silenced[off])
        expect(sunk.map((n) => n.kind)).not.toContain(silenced[off])
      }
  })

})
