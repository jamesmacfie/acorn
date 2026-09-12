// `ctx.events.notice`: one bell row, two tiers, and the tier is what decides how much of the row the
// caller gets to write (./types.ts § PluginBroadcast).
//
// This exists because the seam it replaces had no tier question at all. The bell had left `ctx.events`
// for the `workflows.notices` capability, and the plugins that wanted a row borrowed that capability —
// which can only say "a run, at this node". So the memory-proposal gate raised a row with no
// destination, and clicking it, in the bell or on the desktop banner, did nothing.
import { describe, expect, it, vi } from 'vitest'

const broadcasts: Record<string, unknown>[] = []
vi.mock('../transport/wsHub', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../transport/wsHub')>()),
  wsBroadcast: (frame: Record<string, unknown>) => void broadcasts.push(frame),
}))

import { makeTestNodeContext } from '../../testkit/pluginContext'

const plugin = { name: 'testkit-probe' }
const sent = () => broadcasts.filter((frame) => frame.channel === 'workflow:notice').map((frame) => frame.notice)

describe('a compiled plugin', () => {
  it('sends the notice it wrote, stamped with its own id', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({ plugin })
    try {
      ctx.events.notice({
        taskId: 't1',
        title: '2 memory proposals await review',
        kind: 'memory-proposal',
        target: { kind: 'source', resourceId: 'memory' },
      })
      expect(sent()).toEqual([{
        pluginId: 'testkit-probe',
        taskId: 't1',
        title: '2 memory proposals await review',
        kind: 'memory-proposal',
        target: { kind: 'source', resourceId: 'memory' },
      }])
    } finally {
      ctx.cleanup()
    }
  })

  // A row about the node rather than a task: a connection that expired, a plugin whose setup is
  // incomplete. The client stores `''` for these and skips the task jump.
  it('may name no task at all', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({ plugin })
    try {
      ctx.events.notice({ title: 'Reconnect your account' })
      expect(sent()).toEqual([{ pluginId: 'testkit-probe', title: 'Reconnect your account' }])
    } finally {
      ctx.cleanup()
    }
  })
})

describe('a loaded plugin', () => {
  // Dropped rather than refused, unlike `send`, because the row still lands somewhere: the client
  // stamps this plugin's own rail source (client-core host/plugins/rowTargets.ts). Nothing is
  // invisible, so there is nothing for the author to debug.
  it('cannot name a target, because a target names another plugin\'s handler and resource', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({ plugin, permissions: {} })
    try {
      ctx.events.notice({
        taskId: 't1',
        title: 'Look at this',
        target: { kind: 'workflow-run', resourceId: 'a-run-it-does-not-own' },
      })
      expect(sent()).toEqual([{ pluginId: 'testkit-probe', taskId: 't1', title: 'Look at this', detail: undefined, kind: 'plugin' }])
    } finally {
      ctx.cleanup()
    }
  })

  // `plugin` is the kind whose contribution is `toast: false`, which is what keeps third-party text off
  // the owner's desktop (client-core features/notifications/kindContributions.ts).
  it('cannot pick its own kind, so it cannot buy itself a desktop banner', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({ plugin, permissions: {} })
    try {
      ctx.events.notice({ taskId: 't1', title: 'Urgent!', kind: 'agent-error' })
      expect(sent()[0]).toMatchObject({ kind: 'plugin' })
    } finally {
      ctx.cleanup()
    }
  })

  it('keeps a target only when the manifest declared its kind and notice class', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({
      plugin,
      permissions: {},
      destinations: [{ id: 'memory-review', label: 'Review in Memory', targetKind: 'findings-candidate', noticeKind: 'memory-proposal' }],
    })
    try {
      ctx.events.notice({
        taskId: 't1',
        title: 'Review one finding',
        kind: 'memory-proposal',
        target: { kind: 'findings-candidate', resourceId: 'candidate-1' },
      })
      expect(sent()[0]).toMatchObject({
        kind: 'memory-proposal',
        target: { kind: 'findings-candidate', resourceId: 'candidate-1' },
      })
    } finally {
      ctx.cleanup()
    }
  })

  it('strips a target whose notice class was not declared', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({
      plugin,
      permissions: {},
      destinations: [{ id: 'memory-review', label: 'Review in Memory', targetKind: 'findings-candidate', noticeKind: 'memory-proposal' }],
    })
    try {
      ctx.events.notice({
        taskId: 't1',
        title: 'Spoofed failure',
        kind: 'agent-error',
        target: { kind: 'findings-candidate', resourceId: 'candidate-1' },
      })
      expect(sent()[0]).toEqual({ pluginId: 'testkit-probe', taskId: 't1', title: 'Spoofed failure', detail: undefined, kind: 'plugin' })
    } finally {
      ctx.cleanup()
    }
  })

  it('keeps the title and detail it wrote', () => {
    broadcasts.length = 0
    const ctx = makeTestNodeContext({ plugin, permissions: {} })
    try {
      ctx.events.notice({ title: 'Disk is filling up', detail: '4 GB left' })
      expect(sent()[0]).toMatchObject({ title: 'Disk is filling up', detail: '4 GB left' })
    } finally {
      ctx.cleanup()
    }
  })
})
