import { describe, expect, it } from 'vitest'
import { bridgeRequestSchema, nativeHostRegistration } from './extensionBridge'

describe('browser bridge requests', () => {
  it('accepts each operation in its exact shape', () => {
    for (const request of [
      { v: 1, id: 'a', op: 'nodes.list' },
      { v: 1, id: 'a', op: 'node.probe', endpoint: 'https://node.test:7443' },
      { v: 1, id: 'a', op: 'node.pair', code: 'ABCD-1234', label: 'Laptop' },
      { v: 1, id: 'a', op: 'node.select', nodeId: null },
      { v: 1, id: 'a', op: 'node.forget', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'projects.list', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'tasks.list', nodeId: 'n1', projectId: 'p1' },
      { v: 1, id: 'a', op: 'agents.profiles', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'sessions.list', nodeId: 'n1', taskId: 't1' },
      { v: 1, id: 'a', op: 'session.read', nodeId: 'n1', sessionId: 's1', afterSeq: 0, limit: 500 },
      {
        v: 1,
        id: 'a',
        op: 'session.create',
        nodeId: 'n1',
        taskId: 't1',
        providerId: 'p',
        profileId: 'p',
        key: 'k'.repeat(8),
      },
      { v: 1, id: 'a', op: 'turn.submit', nodeId: 'n1', sessionId: 's1', text: 'hi', key: 'k'.repeat(36) },
    ])
      expect(bridgeRequestSchema.safeParse(request).success).toBe(true)
  })

  it('refuses another version, an unknown operation, and smuggled fields', () => {
    for (const request of [
      { v: 2, id: 'a', op: 'nodes.list' },
      { v: 1, id: 'a', op: 'fetch', path: '/v1/core/projects' },
      { v: 1, id: 'a', op: 'node.pair', code: 'X', label: 'L', endpoint: 'https://other.test' },
      { v: 1, id: 'a', op: 'projects.list' },
      { v: 1, id: '', op: 'nodes.list' },
      { v: 1, id: 'a', op: 'session.read', nodeId: 'n1', sessionId: 's1', afterSeq: 0, limit: 501 },
      { v: 1, id: 'a', op: 'turn.submit', nodeId: 'n1', sessionId: 's1', text: 'hi', key: 'short' },
      { v: 1, id: 'a', op: 'turn.submit', nodeId: 'n1', sessionId: 's1', text: 'x'.repeat(60_001), key: 'k'.repeat(8) },
      {
        v: 1,
        id: 'a',
        op: 'turn.submit',
        nodeId: 'n1',
        sessionId: 's1',
        text: 'hi',
        key: 'k'.repeat(8),
        source: 'plugin',
      },
    ])
      expect(bridgeRequestSchema.safeParse(request).success).toBe(false)
  })
})

describe('native host registration', () => {
  it('allows exactly one extension in the form each browser expects', () => {
    expect(nativeHostRegistration('chrome', 'com.acorn.browser_bridge', '/x/host')).toEqual({
      name: 'com.acorn.browser_bridge',
      description: 'Acorn browser bridge',
      path: '/x/host',
      type: 'stdio',
      allowed_origins: ['chrome-extension://ciaaplnahgpccadenkacgipmhmpbddjo/'],
    })
    expect(nativeHostRegistration('firefox', 'com.acorn.browser_bridge', '/x/host')).toMatchObject({
      allowed_extensions: ['extension@acorn.dev'],
    })
  })
})
