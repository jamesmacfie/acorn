// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkflowNotice } from '../../infra/node/wsClient'

// The socket, so `initWorkflowNotices` can be driven a frame at a time. Nothing else in this file
// touches it, and deliver.ts imports exactly this one function from it.
let onNotice: ((notice: WorkflowNotice) => void) | undefined
vi.mock('../../infra/node/wsClient', () => ({
  wsOnNotice: (cb: (notice: WorkflowNotice) => void) => {
    onNotice = cb
    return () => { onNotice = undefined }
  },
}))

import {
  HOLD_MS, defaultDeliveryContext, deliverNotice, initWorkflowNotices, observeAttention,
  registerNoticeSink, resetDelivery, setHostFocused, systemSink, type DeliveryContext,
  type NoticeSink,
} from './deliver'
import { noticeKindContributions } from './kindContributions'
import { noticeKindRegistry } from '../../host/registries/rail/notices'
import { _resetPluginRowSources, setPluginRowSource } from '../../host/plugins/rowTargets'
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

// The shell registers these at boot (apps/desktop/src/client/activate.ts) and the system sink reads
// them: a kind's `toast` is what says whether the row may reach the desktop. Without them every
// banner assertion below would be measuring an empty registry.
for (const kind of noticeKindContributions) noticeKindRegistry.register(kind)

beforeEach(() => {
  vi.useFakeTimers()
  focused = false
  settings = DEFAULT_NOTIFICATION_SETTINGS
  sunk = []
  dropSink = registerNoticeSink(sink)
  resetDelivery()
  _resetNotices()
  _resetPluginRowSources()
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

  // The terminal client's half of the rule. It is not a document, so it has no `hasFocus()` to ask;
  // it hears DEC 1004 focus reports from the renderer and installs the answer here
  // (apps/tui/src/main.tsx). Unknown still counts as focused, which is what a host that never
  // installs one falls back to.
  it('takes a host\'s own answer about whether it is on screen', () => {
    expect(defaultDeliveryContext.focused()).toBe(true)
    let onScreen = false
    setHostFocused(() => onScreen)
    try {
      expect(defaultDeliveryContext.focused()).toBe(false)
      onScreen = true
      expect(defaultDeliveryContext.focused()).toBe(true)
    } finally {
      setHostFocused(null)
    }
    expect(defaultDeliveryContext.focused()).toBe(true)
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

// The sinks read the device store directly rather than the gate's context, because they run after
// the gate has already decided. `system` on is what a device with no preference reads, so only "off"
// needs saying.
const device = vi.hoisted(() => ({ system: true }))
vi.mock('./settings', async (original) => ({
  ...(await original<object>()),
  readNotificationSettings: () => ({ sound: true, system: device.system, badge: true, events: { blocked: true, finished: true, error: true } }),
}))

describe('the system channel', () => {
  const shown: { title: string; body?: string; tag: string }[] = []
  beforeEach(() => {
    device.system = true
    shown.length = 0
    vi.stubGlobal('window', {
      acorn: { notify: { show: async (r: { title: string; body?: string; tag: string }) => { shown.push(r); return true }, onActivate: () => () => {}, setBadge: () => {} } },
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('raises a banner for an edge you missed and none for one you watched', () => {
    const drop = registerNoticeSink(systemSink)
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    settle()
    focused = true
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    settle()
    drop()
    expect(shown.map((r) => r.title)).toEqual(['claude needs you'])
  })

  it('is silent when the switch is off', () => {
    device.system = false
    const drop = registerNoticeSink(systemSink)
    observeAttention([snap('working')], context)
    observeAttention([snap('blocked')], context)
    settle()
    drop()
    expect(shown).toEqual([])
  })

  // The OS keeps what it is shown. A detail is written for the notification centre; a title can name
  // a file the agent is asking about, and it is the row's, not the banner's body.
  it('sends the detail as the body and never the title', () => {
    const drop = registerNoticeSink(systemSink)
    deliverNotice({ taskId: 't1', kind: 'agent-needs-input', title: 'edit /etc/hosts?', at: 1, detail: 'Review & trust' }, context)
    deliverNotice({ taskId: 't1', kind: 'agent-needs-input', title: 'edit /etc/hosts?', at: 2 }, context)
    drop()
    expect(shown.map((r) => r.body)).toEqual(['Review & trust', undefined])
  })

  // `toast` is the kind's own answer, and it went unread for as long as it existed: three kinds
  // declared `false` with a comment saying why and banner-ed anyway. It is load-bearing now, because a
  // loaded plugin's notice is forced to the `plugin` kind precisely so third-party code cannot put
  // text on the owner's desktop (node-core server/pluginHost/context.ts).
  it('obeys the kind, so a bell-only kind never reaches the desktop', () => {
    const drop = registerNoticeSink(systemSink)
    deliverNotice({ taskId: 't1', kind: 'disk-unencrypted', title: 'This disk is not encrypted', at: 1 }, context)
    deliverNotice({ taskId: 't1', kind: 'plugin', title: 'A loaded plugin said something', at: 2 }, context)
    deliverNotice({ taskId: 't1', kind: 'agent-error', title: 'claude failed', at: 3 }, context)
    drop()
    expect(shown.map((r) => r.title)).toEqual(['claude failed'])
  })

  // The same rule via the fallback: an unregistered kind resolves to `plugin`, which stays in the bell.
  it('keeps an unknown kind out of the desktop too', () => {
    const drop = registerNoticeSink(systemSink)
    deliverNotice({ taskId: 't1', kind: 'not-a-registered-kind', title: 'who knows', at: 1 }, context)
    drop()
    expect(shown).toEqual([])
  })
})

// A workflow notice names the run it came from, and that is what gives the bell row somewhere to go
// (docs/notifications.md § What a row points at).
describe('workflow notices', () => {
  const frame = (over: Partial<WorkflowNotice>): WorkflowNotice =>
    ({ taskId: 't1', kind: 'gate', title: 'a gate', ...over })

  it('turns a run and a step into a workflow-run target', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ runId: 'run-1', stepId: 'step-2' }))
    expect(notices()[0].target).toEqual({ kind: 'workflow-run', resourceId: 'run-1', subresourceId: 'step-2' })
    stop()
  })

  it('names no step when the frame names none', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ kind: 'run-done', runId: 'run-1' }))
    expect(notices()[0].target).toEqual({ kind: 'workflow-run', resourceId: 'run-1' })
    stop()
  })

  it('keeps no target for a core notice, which carries an action instead', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ kind: 'repo-config-trust', title: 'Repo configuration needs review', action: 'review-config' }))
    expect(notices()[0].target).toBeUndefined()
    expect(notices()[0].detail).toBe('Review & trust')
    stop()
  })
})

// The seam this channel grew for: any plugin can raise a row and say where it goes. The memory
// proposal gate is why — it borrowed workflows' notice channel, which could only name a run, so its
// row swallowed every click (docs/notifications.md § What a row points at).
describe('a plugin notice', () => {
  const frame = (over: Partial<WorkflowNotice>): WorkflowNotice =>
    ({ title: 'something happened', ...over })

  it('carries the target its raiser named', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ taskId: 't1', kind: 'memory-proposal', target: { kind: 'source', resourceId: 'memory' } }))
    expect(notices()[0].target).toEqual({ kind: 'source', resourceId: 'memory' })
    expect(notices()[0].kind).toBe('memory-proposal')
    stop()
  })

  // A target beats the shorthand, so a plugin that names one is never second-guessed.
  it('prefers a named target over the runId a node might also send', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ runId: 'run-1', target: { kind: 'source', resourceId: 'memory' } }))
    expect(notices()[0].target).toEqual({ kind: 'source', resourceId: 'memory' })
    stop()
  })

  // The loaded tier names no target: the node drops it, so the row arrives with a plugin id and
  // nothing else, and the honest answer is the surface that plugin contributed.
  it('falls back to the raising plugin rail source', () => {
    setPluginRowSource('board', 'board.issues')
    const stop = initWorkflowNotices()
    onNotice?.(frame({ pluginId: 'board' }))
    expect(notices()[0].target).toEqual({ kind: 'source', resourceId: 'board.issues' })
    stop()
  })

  it('falls back to the plugins settings page for a plugin with no source of its own', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ pluginId: 'stats' }))
    expect(notices()[0].target).toEqual({ kind: 'settings', resourceId: 'plugins' })
    stop()
  })

  // A row about the node rather than a task. `''` is what the ring stores, so every per-task filter in
  // it treats the row as belonging to no task, and the bell skips the task jump.
  it('stores an empty task id for a notice that names no task', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ pluginId: 'stats' }))
    expect(notices()[0].taskId).toBe('')
    stop()
  })

  it('draws as a plugin row when the kind is missing', () => {
    const stop = initWorkflowNotices()
    onNotice?.(frame({ pluginId: 'stats' }))
    expect(notices()[0].kind).toBe('plugin')
    stop()
  })
})
