// @vitest-environment node
import { describe, expect, it } from 'vitest'
import type { TerminalSession } from '../../../shared/terminal'
import {
  capNotices,
  detectEdges,
  hydrateNotices,
  markAllRead,
  markTaskRead,
  NOTICE_CAP,
  notices,
  pushNotice,
  serializeNotices,
  shouldToast,
  unreadCount,
  unreadForTask,
  type Notice,
} from './notifications'

type S = Pick<TerminalSession, 'id' | 'taskId' | 'title' | 'kind' | 'status' | 'idle' | 'agentState' | 'exitCode'>
const agent = (over: Partial<S>): S => ({
  id: 's1',
  taskId: 't1',
  title: 'claude',
  kind: 'agent',
  status: 'running',
  idle: false,
  agentState: 'working',
  exitCode: null,
  ...over,
})

describe('detectEdges (docs/next 05)', () => {
  it('working → idle raises finished', () => {
    const out = detectEdges([agent({})], [agent({ idle: true, agentState: 'idle' })], 100)
    expect(out).toEqual([{ taskId: 't1', kind: 'finished', title: 'claude finished', detail: 'agent went idle', at: 100 }])
  })
  it('→ blocked raises needs-input (and suppresses the finished edge)', () => {
    const out = detectEdges([agent({})], [agent({ idle: true, agentState: 'blocked' })], 100)
    expect(out).toEqual([{ taskId: 't1', kind: 'needs-input', title: 'claude needs input', at: 100 }])
  })
  it('exit raises exited/error by code', () => {
    expect(detectEdges([agent({})], [agent({ status: 'exited', exitCode: 0, agentState: 'done' })], 1)[0].kind).toBe('exited')
    const err = detectEdges([agent({})], [agent({ status: 'exited', exitCode: 1, agentState: 'done' })], 1)[0]
    expect(err.kind).toBe('error')
    expect(err.title).toContain('code 1')
  })
  it('tracks edges only against a known previous state — no phantom edges', () => {
    expect(detectEdges([], [agent({ idle: true, agentState: 'idle' })], 1)).toEqual([])
    // No change → no edge (a suppressed notification never desyncs the next transition).
    const idle = agent({ idle: true, agentState: 'idle' })
    expect(detectEdges([idle], [idle], 1)).toEqual([])
  })
  it('shells only raise exit edges', () => {
    const shell = agent({ kind: 'shell', agentState: 'unknown' })
    expect(detectEdges([shell], [{ ...shell, idle: true }], 1)).toEqual([])
    expect(detectEdges([shell], [{ ...shell, status: 'exited', exitCode: 1 }], 1)[0].kind).toBe('error')
  })
})

describe('ring cap + read state + pref round-trip', () => {
  it('caps at NOTICE_CAP keeping the newest', () => {
    const list = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, taskId: 't', kind: 'finished', title: `x${i}`, at: i, read: false }) as Notice)
    const capped = capNotices(list)
    expect(capped).toHaveLength(NOTICE_CAP)
    expect(capped[0].id).toBe('n0')
  })
  it('push/markTaskRead/markAllRead/serialize/hydrate round-trip', () => {
    markAllRead()
    pushNotice({ taskId: 'tA', kind: 'finished', title: 'a done', at: 1 })
    pushNotice({ taskId: 'tB', kind: 'needs-input', title: 'b blocked', at: 2 })
    expect(unreadCount()).toBe(2)
    expect(unreadForTask('tB')).toBe(1)
    markTaskRead('tB')
    expect(unreadForTask('tB')).toBe(0)
    expect(unreadCount()).toBe(1)

    const blob = serializeNotices()
    markAllRead()
    hydrateNotices(blob) // same ids → no duplicates
    expect(notices().filter((n) => n.title === 'a done')).toHaveLength(1)
    hydrateNotices('{malformed') // never throws
  })
})

describe('shouldToast (focus gate + cooldown/dedup)', () => {
  it('suppresses when focused; dedups within the cooldown per (task, kind)', () => {
    const lastToastAt = new Map<string, number>()
    const n = { taskId: 't1', kind: 'finished' as const, at: 1000 }
    expect(shouldToast(n, { focused: true, lastToastAt })).toBe(false)
    expect(shouldToast(n, { focused: false, lastToastAt, cooldownMs: 500 })).toBe(true)
    expect(shouldToast({ ...n, at: 1200 }, { focused: false, lastToastAt, cooldownMs: 500 })).toBe(false)
    expect(shouldToast({ ...n, at: 1600 }, { focused: false, lastToastAt, cooldownMs: 500 })).toBe(true)
    // A different kind for the same task is a different key.
    expect(shouldToast({ taskId: 't1', kind: 'needs-input', at: 1601 }, { focused: false, lastToastAt, cooldownMs: 500 })).toBe(true)
  })
})
