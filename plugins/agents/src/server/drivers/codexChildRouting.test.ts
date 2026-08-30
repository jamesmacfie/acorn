/**
 * Codex child-thread routing, pinned against a real capture.
 *
 * This is the code that decides, per notification, whether traffic reaches the parent session at all,
 * so the cost of a wrong answer is not a missing sidebar row but a corrupted parent lifecycle. The
 * fixture is codex-cli 0.146.1 driven over stdio with gpt-5.6-luna, prompted into a two-child fan-out
 * (alpha and beta). Hand-written shapes would only test what we hoped the wire looked like.
 */
import { describe, expect, it } from 'vitest'
import capture from './__fixtures__/codexSubagentWire.json' with { type: 'json' }
import type { JsonRpcNotification } from './jsonRpcProcess'
import { evolveAgentState, initialAgentMachineState } from '../sessions/stateMachine'
import { normalizeCodexNotification } from './codexNormalizer'
import {
  CodexChildRouter,
  codexNotificationThreadId,
  routeCodexChildNotification,
} from './codexChildRouting'

const notifications = capture.notifications as JsonRpcNotification[]
const rootThreadId = capture.rootThreadId
const childThreadIds = new Set(capture.childThreadIds)

const childNotifications = notifications.filter((notification) =>
  childThreadIds.has(codexNotificationThreadId(notification) ?? ''))

const replay = (): { router: CodexChildRouter; rosterFor: (id: string) => Array<Record<string, unknown>> } => {
  const router = new CodexChildRouter()
  router.setRootThread(rootThreadId)
  const roster = new Map<string, Array<Record<string, unknown>>>()
  for (const notification of notifications) {
    const routed = router.route(notification)
    if (routed.to === 'parent') continue
    for (const event of routed.events) {
      if (event.type !== 'subagent') continue
      const existing = roster.get(event.subagent.id) ?? []
      existing.push(event.subagent as unknown as Record<string, unknown>)
      roster.set(event.subagent.id, existing)
    }
  }
  return { router, rosterFor: (id) => roster.get(id) ?? [] }
}

describe('the captured Codex fan-out', () => {
  it('is a real two-child fan-out', () => {
    expect(capture.capturedWith.cli).toBe('codex-cli 0.146.1')
    expect(childThreadIds.size).toBe(2)
    const paths = notifications.flatMap((notification) => {
      const item = notification.params.item as { type?: string; agentPath?: string } | undefined
      return item?.type === 'subAgentActivity' && item.agentPath ? [item.agentPath] : []
    })
    expect(paths).toContain('/root/alpha')
    expect(paths).toContain('/root/beta')
  })

  it('gives a child no thread/started of its own', () => {
    // The whole reason `subAgentActivity` is the only registration signal. t3code's other registration
    // path reads `thread.source.subAgent.thread_spawn`, and on this version `source` is the string
    // "vscode" on the one thread/started there is.
    const started = notifications.filter((notification) => notification.method === 'thread/started')
    expect(started).toHaveLength(1)
    expect(codexNotificationThreadId(started[0])).toBe(rootThreadId)
    expect(typeof (started[0].params.thread as { source?: unknown }).source).toBe('string')
  })

  it('emits child traffic BEFORE the item that registers the child', () => {
    const firstChild = notifications.findIndex((notification) =>
      childThreadIds.has(codexNotificationThreadId(notification) ?? ''))
    const firstRegistration = notifications.findIndex((notification) =>
      (notification.params.item as { type?: string } | undefined)?.type === 'subAgentActivity')
    expect(firstChild).toBeGreaterThanOrEqual(0)
    expect(firstChild).toBeLessThan(firstRegistration)
  })
})

describe('routeCodexChildNotification', () => {
  it('routes every captured child method to a defined disposition', () => {
    const methods = new Set(childNotifications.map((notification) => notification.method))
    expect(methods.size).toBeGreaterThan(0)
    for (const method of methods) {
      // Nothing a child sends may reach the parent path. Every one of these is either the subagent's
      // own news or named chatter.
      expect(routeCodexChildNotification(method)).not.toBe('parent')
    }
  })

  it('never routes child-owned thread lifecycle to the parent', () => {
    // These drive PARENT state in codexNormalizer: runtime state, turn completion, compaction. A child
    // emitting one and reaching the parent path is the bug this whole module exists to prevent.
    for (const method of [
      'thread/started',
      'thread/status/changed',
      'thread/archived',
      'thread/unarchived',
      'thread/closed',
      'thread/compacted',
      'thread/name/updated',
      'thread/tokenUsage/updated',
      'turn/started',
      'turn/completed',
      'turn/plan/updated',
      'item/plan/delta',
    ]) {
      expect(routeCodexChildNotification(method), method).not.toBe('parent')
    }
  })

  it('sends parent-owned and unknown methods to the parent', () => {
    // Unknown takes this route by design. A Codex release that adds a notification must degrade to
    // "the parent sees it", never to silent loss.
    expect(routeCodexChildNotification('serverRequest/resolved')).toBe('parent')
    expect(routeCodexChildNotification('thread/somethingBrandNew')).toBe('parent')
    expect(routeCodexChildNotification('account/rateLimits/updated')).toBe('parent')
  })
})

describe('CodexChildRouter over the capture', () => {
  it('registers both children and names them from their agent path', () => {
    const { rosterFor } = replay()
    for (const [threadId, name] of [...childThreadIds].map((id, index) => [id, ['alpha', 'beta'][index]] as const)) {
      const updates = rosterFor(threadId)
      expect(updates.length, threadId).toBeGreaterThan(0)
      expect(updates.some((update) => update.title === name), `${threadId} named ${name}`).toBe(true)
    }
  })

  it('settles a finished child as idle rather than completed', () => {
    // Codex's terminal state for a child is idle-and-resumable: the capture has no thread/closed at
    // all. Reporting it as completed would tell the reader the subagent is gone.
    const { rosterFor } = replay()
    for (const threadId of childThreadIds) {
      const statuses = rosterFor(threadId).flatMap((update) => update.status ? [update.status] : [])
      expect(statuses, threadId).toContain('running')
      expect(statuses[statuses.length - 1], threadId).toBe('idle')
    }
  })

  it('does not call a child idle before it has ever run', () => {
    // A child's first thread/status/changed is `idle`, before it starts. Reporting that as settled
    // flashes "Idle" on a subagent that has not done anything yet.
    const { rosterFor } = replay()
    for (const threadId of childThreadIds) {
      const statuses = rosterFor(threadId).flatMap((update) => update.status ? [update.status] : [])
      expect(statuses.indexOf('idle'), threadId).toBeGreaterThan(statuses.indexOf('running'))
    }
  })

  it('reports each child’s own token usage', () => {
    const { rosterFor } = replay()
    for (const threadId of childThreadIds) {
      const usages = rosterFor(threadId).flatMap((update) => update.usage ? [update.usage] : [])
      expect(usages.length, threadId).toBeGreaterThan(0)
    }
  })

  it('leaves the parent’s own traffic on the parent path', () => {
    const router = new CodexChildRouter()
    router.setRootThread(rootThreadId)
    const rootTurnCompleted = notifications.find((notification) =>
      notification.method === 'turn/completed' && codexNotificationThreadId(notification) === rootThreadId)
    expect(rootTurnCompleted).toBeDefined()
    for (const notification of notifications) {
      const routed = router.route(notification)
      if (notification === rootTurnCompleted) expect(routed.to).toBe('parent')
    }
  })
})

describe('CodexChildRouter guards', () => {
  const activity = (threadId: string, agentThreadId: string, agentPath: string): JsonRpcNotification => ({
    method: 'item/completed',
    params: {
      threadId,
      item: { type: 'subAgentActivity', id: 'call_1', kind: 'interacted', agentThreadId, agentPath },
    },
  })

  it('never opens a roster row for the session itself', () => {
    // The wire reports subAgentActivity ABOUT the root, with agentPath "/root", and emits it FROM a
    // child thread. t3code registered that and the session hung on "working" forever, because its
    // routing asked "is this thread a known child?". Acorn asks "is this thread the root?" instead, so
    // a bogus registration cannot capture the parent, and what is left to get wrong is a phantom
    // subagent row for the session itself. Both spellings are guarded: by thread id and by path.
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    expect(router.route(activity('child-1', 'root-1', '/root'))).toEqual({ to: 'subagent', events: [] })
    expect(router.route(activity('child-1', 'root-1', '/root/alpha'))).toEqual({ to: 'subagent', events: [] })
    expect(router.route(activity('child-1', 'other-1', '/root'))).toEqual({ to: 'subagent', events: [] })
  })

  it('keys routing on the arriving thread, not on what is registered', () => {
    // Which is why the hang above cannot happen here: the root is answered before the registry is
    // consulted at all.
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    router.route(activity('child-1', 'root-1', '/root'))
    expect(router.route({
      method: 'turn/completed',
      params: { threadId: 'root-1', turn: { status: 'completed' } },
    }).to).toBe('parent')
  })

  it('treats an unknown non-root thread as a child rather than the parent', () => {
    // Stricter than passing an unrecognised thread through. The root id is known from thread/start, so
    // "not the root" is a complete answer, and it is what makes child-first ordering harmless.
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    const routed = router.route({
      method: 'thread/status/changed',
      params: { threadId: 'surprise-1', status: { type: 'active' } },
    })
    expect(routed).toMatchObject({ to: 'subagent' })
    expect(routed.to === 'subagent' && routed.events[0]).toMatchObject({
      type: 'subagent',
      subagent: { id: 'surprise-1', status: 'running' },
    })
  })

  it('releases a thread that turns out to be the root', () => {
    // A resumed session can learn its own thread id after traffic has started. Anything registered
    // under that id was the parent all along, and leaving it registered intercepts the parent forever.
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    router.route({ method: 'turn/started', params: { threadId: 'late-root' } })
    router.setRootThread('late-root')
    expect(router.route({ method: 'turn/started', params: { threadId: 'late-root' } }).to).toBe('parent')
  })

  it('keeps a failing child off the parent’s error path', () => {
    // Failing the whole session over one subagent is worse than the subagent's failure. The row
    // carries the status and a diagnostic carries the words.
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    router.route(activity('root-1', 'child-1', '/root/alpha'))
    const routed = router.route({
      method: 'error',
      params: { threadId: 'child-1', message: 'the subagent broke' },
    })
    expect(routed.to).toBe('subagent')
    const events = routed.to === 'subagent' ? routed.events : []
    expect(events.some((event) => event.type === 'error')).toBe(false)
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'subagent', subagent: expect.objectContaining({ status: 'failed' }) }),
      expect.objectContaining({ type: 'diagnostic', message: expect.stringContaining('alpha') }),
    ]))
  })

  it('attributes a child’s file change to that child', () => {
    // A subagent's run has to show what it changed, not only which tool it ran.
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    router.route(activity('root-1', 'child-1', '/root/alpha'))
    const routed = router.route({
      method: 'item/fileChange/patchUpdated',
      params: { threadId: 'child-1', path: 'src/a.ts', patch: '@@ -1 +1 @@' },
    })
    expect(routed.to === 'subagent' && routed.events[0]).toMatchObject({
      type: 'file_change',
      path: 'src/a.ts',
      subagentId: 'child-1',
    })
  })

  it('attributes a child’s items and prose to that child', () => {
    const router = new CodexChildRouter()
    router.setRootThread('root-1')
    router.route(activity('root-1', 'child-1', '/root/alpha'))
    const prose = router.route({
      method: 'item/agentMessage/delta',
      params: { threadId: 'child-1', itemId: 'msg-1', delta: 'Teal' },
    })
    expect(prose.to === 'subagent' && prose.events[0]).toMatchObject({
      type: 'assistant_message',
      text: 'Teal',
      subagentId: 'child-1',
    })
    const command = router.route({
      method: 'item/started',
      params: {
        threadId: 'child-1',
        item: { type: 'commandExecution', id: 'cmd-1', command: 'ls' },
      },
    })
    expect(command.to === 'subagent' && command.events[0]).toMatchObject({
      type: 'tool',
      tool: { id: 'cmd-1', subagentId: 'child-1' },
    })
  })

  it('routes nothing as a child before the root thread is known', () => {
    const router = new CodexChildRouter()
    expect(router.route({ method: 'turn/started', params: { threadId: 'anything' } }).to).toBe('parent')
  })
})

describe('the parent session\u2019s lifecycle across a fan-out', () => {
  // The regression that is hardest to see by eye, and the reason this module exists. Replays the whole
  // capture the way codexDriver does — route first, and only normalize what the router calls the
  // parent's — then runs the resulting events through the session state machine.
  const trajectory = (): string[] => {
    const router = new CodexChildRouter()
    router.setRootThread(rootThreadId)
    let state = evolveAgentState(initialAgentMachineState(), { type: 'user_message', text: 'go' }, 'turn-1')
    const states = [state.runtimeState]
    for (const notification of notifications) {
      if (router.route(notification).to !== 'parent') continue
      for (const event of normalizeCodexNotification(notification)) {
        state = evolveAgentState(state, event, 'turn-1')
        if (states[states.length - 1] !== state.runtimeState) states.push(state.runtimeState)
      }
    }
    return states
  }

  it('goes ready exactly once, at the end', () => {
    // A child's turn/completed or idle status reaching the parent path shows up here as an early
    // 'ready': the session reports itself finished while its subagents are still working.
    const states = trajectory()
    expect(states.filter((state) => state === 'ready')).toHaveLength(1)
    expect(states[states.length - 1]).toBe('ready')
  })

  it('reaches ready at all', () => {
    // The other half of the same bug. Intercepting the parent's OWN turn/completed leaves the session
    // stuck on working after every subagent has finished, which is how t3code's hang presented.
    expect(trajectory()).toContain('ready')
  })

  it('never fails the session over a subagent', () => {
    expect(trajectory()).not.toContain('failed')
  })
})
