// @vitest-environment node
import { describe, expect, it, afterEach, beforeEach } from 'vitest'
import { setActiveNode } from '../../infra/node/activeNode'
import {
  _resetNotices,
  capNotices,
  dropNoticesForTask,
  hydrateNotices,
  markAllRead,
  markTaskRead,
  NOTICE_CAP,
  notices,
  noticesForActiveNode,
  pushNotice,
  serializeNotices,
  unreadCount,
  unreadForTask,
  type Notice,
} from './notifications'

describe('ring cap + read state + pref round-trip', () => {
  it('caps at NOTICE_CAP keeping the newest', () => {
    const list = Array.from({ length: 60 }, (_, i) => ({ id: `n${i}`, taskId: 't', kind: 'agent-completed', title: `x${i}`, at: i, read: false }) as Notice)
    const capped = capNotices(list)
    expect(capped).toHaveLength(NOTICE_CAP)
    expect(capped[0].id).toBe('n0')
  })
  it('push/markTaskRead/markAllRead/serialize/hydrate round-trip', () => {
    markAllRead()
    pushNotice({ taskId: 'tA', kind: 'agent-completed', title: 'a done', at: 1 })
    pushNotice({ taskId: 'tB', kind: 'agent-needs-input', title: 'b blocked', at: 2 })
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

// A notice belongs to whichever node produced the frame or session list behind it. Without the stamp,
// switching nodes showed node A's "claude finished" rows in node B's bell, pointing at tasks the user
// can't reach from there, with a rail badge counting them against node B's task ids.
describe('notices are scoped to the node that raised them', () => {
  beforeEach(() => _resetNotices())
  afterEach(() => setActiveNode(null))

  it('stamps the active node and filters the visible list by it', () => {
    setActiveNode('node-a')
    pushNotice({ taskId: 'tA', kind: 'agent-completed', title: 'on a', at: 1 })
    setActiveNode('node-b')
    pushNotice({ taskId: 'tB', kind: 'agent-completed', title: 'on b', at: 2 })

    expect(noticesForActiveNode().map((n) => n.title)).toEqual(['on b'])
    expect(unreadCount()).toBe(1)
    setActiveNode('node-a')
    expect(noticesForActiveNode().map((n) => n.title)).toEqual(['on a'])
    expect(unreadCount()).toBe(1)
    // Both are still in the ring: this is a filter, not an eviction, so switching back restores the
    // history rather than losing it.
    expect(notices()).toHaveLength(2)
  })

  it('counts per task within the active node only', () => {
    setActiveNode('node-a')
    pushNotice({ taskId: 'shared-id', kind: 'agent-completed', title: 'on a', at: 1 })
    setActiveNode('node-b')
    // The same task id on another node, the collision docs/architecture-overview.md says must never
    // collide.
    pushNotice({ taskId: 'shared-id', kind: 'agent-completed', title: 'on b', at: 2 })
    expect(unreadForTask('shared-id')).toBe(1)
  })

  it('marks read only what the bell is showing', () => {
    setActiveNode('node-a')
    pushNotice({ taskId: 'tA', kind: 'agent-completed', title: 'on a', at: 1 })
    setActiveNode('node-b')
    pushNotice({ taskId: 'tB', kind: 'agent-completed', title: 'on b', at: 2 })
    markAllRead()
    setActiveNode('node-a')
    // Still unread: the popover that "marked all read" never displayed it.
    expect(unreadCount()).toBe(1)
  })
})

// An archived task's notices point at an id that no longer resolves: the row still counts in the pill
// and clicking it navigates nowhere. deliver.ts wires this to `runtime:task-archived`.
describe('archiving a task takes its notices with it', () => {
  beforeEach(() => _resetNotices())
  afterEach(() => setActiveNode(null))

  it('drops the archived task rows and leaves the rest alone', () => {
    setActiveNode('node-a')
    pushNotice({ taskId: 'gone', kind: 'agent-completed', title: 'archived task', at: 1 })
    pushNotice({ taskId: 'kept', kind: 'agent-completed', title: 'other task', at: 2 })
    dropNoticesForTask('gone')
    expect(noticesForActiveNode().map((n) => n.title)).toEqual(['other task'])
    expect(unreadCount()).toBe(1)
  })

  it("leaves another node's rows alone when two nodes share a task id", () => {
    setActiveNode('node-a')
    pushNotice({ taskId: 'shared-id', kind: 'agent-completed', title: 'on a', at: 1 })
    setActiveNode('node-b')
    pushNotice({ taskId: 'shared-id', kind: 'agent-completed', title: 'on b', at: 2 })
    // The event carries no node, so the drop is scoped to the node the client is looking at.
    dropNoticesForTask('shared-id')
    expect(noticesForActiveNode()).toHaveLength(0)
    setActiveNode('node-a')
    expect(noticesForActiveNode().map((n) => n.title)).toEqual(['on a'])
  })
})
