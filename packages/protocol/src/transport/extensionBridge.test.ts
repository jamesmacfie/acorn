import { describe, expect, it } from 'vitest'
import { bridgeRequestSchema, nativeHostRegistration } from './extensionBridge'

const text = (value: string) => ({ type: 'text', text: value })
const context = (content: string) => ({
  type: 'context',
  contextId: 'c1',
  label: 'Page',
  content,
  source: 'browser-extension',
  capturedAt: 1,
})
const resolve = (resolution: unknown) => ({
  v: 1,
  id: 'a',
  op: 'request.resolve',
  nodeId: 'n1',
  sessionId: 's1',
  requestId: 'r1',
  resolution,
  key: 'k'.repeat(36),
})
const submit = (input: unknown[]) => ({
  v: 1,
  id: 'a',
  op: 'turn.submit',
  nodeId: 'n1',
  sessionId: 's1',
  input,
  key: 'k'.repeat(8),
})

describe('browser bridge requests', () => {
  it('accepts each operation in its exact shape', () => {
    for (const request of [
      { v: 1, id: 'a', op: 'nodes.list' },
      { v: 1, id: 'a', op: 'node.probe', endpoint: 'https://node.test:7443' },
      { v: 1, id: 'a', op: 'node.pair', code: 'ABCD-1234', label: 'Laptop' },
      { v: 1, id: 'a', op: 'node.select', nodeId: null },
      { v: 1, id: 'a', op: 'node.forget', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'node.rename', nodeId: 'n1', label: 'Studio Mac' },
      { v: 1, id: 'a', op: 'projects.list', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'tasks.list', nodeId: 'n1', projectId: 'p1' },
      { v: 1, id: 'a', op: 'agents.choices', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'agents.choices', nodeId: 'n1', refresh: true },
      { v: 1, id: 'a', op: 'sessions.list', nodeId: 'n1', taskId: 't1' },
      { v: 1, id: 'a', op: 'sessions.list', nodeId: 'n1', workspaceId: 'w1' },
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
      {
        v: 1,
        id: 'a',
        op: 'session.create',
        nodeId: 'n1',
        taskId: 't1',
        providerId: 'p',
        profileId: 'p',
        customAgentId: 'reviewer',
        account: 'work-2',
        key: 'k'.repeat(8),
      },
      { v: 1, id: 'a', op: 'turn.submit', nodeId: 'n1', sessionId: 's1', input: [text('hi')], key: 'k'.repeat(36) },
      {
        v: 1,
        id: 'a',
        op: 'turn.submit',
        nodeId: 'n1',
        sessionId: 's1',
        input: [context('https://example.test'), { type: 'image', attachmentId: 'a1', alt: 'Screenshot' }],
        key: 'k'.repeat(36),
      },
      {
        v: 1,
        id: 'a',
        op: 'attachment.upload',
        nodeId: 'n1',
        taskId: 't1',
        filename: 'Screenshot.png',
        mediaType: 'image/png',
        data: 'iVBORw0K',
      },
      { v: 1, id: 'a', op: 'attachment.read', nodeId: 'n1', taskId: 't1', attachmentId: 'a1' },
      { v: 1, id: 'a', op: 'attachment.delete', nodeId: 'n1', taskId: 't1', attachmentId: 'a1' },
      resolve({ optionId: 'allow_once' }),
      resolve({ answers: { pick: 'Blue', many: ['A', 'B'], typed: '', token: 'hunter2' } }),
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
      { v: 1, id: 'a', op: 'sessions.list', nodeId: 'n1' },
      { v: 1, id: 'a', op: 'sessions.list', nodeId: 'n1', taskId: 't1', workspaceId: 'w1' },
      { v: 1, id: 'a', op: 'session.read', nodeId: 'n1', sessionId: 's1', afterSeq: 0, limit: 501 },
      { v: 1, id: 'a', op: 'turn.submit', nodeId: 'n1', sessionId: 's1', input: [text('hi')], key: 'short' },
      { v: 1, id: 'a', op: 'turn.submit', nodeId: 'n1', sessionId: 's1', input: [], key: 'k'.repeat(8) },
      submit([text('x'.repeat(60_001))]),
      submit([text('a'), text('b')]),
      // A file part would name a worktree path; the sidebar never sends one.
      submit([{ type: 'file', path: 'secrets.env' }]),
      submit([{ ...context('x'), source: 'github' }]),
      submit(Array.from({ length: 9 }, () => context('x'))),
      submit([context('x'.repeat(300_000)), context('x'.repeat(300_000))]),
      submit(Array.from({ length: 9 }, (_, index) => ({ type: 'image', attachmentId: `a${index}` }))),
      { ...submit([text('hi')]), source: 'plugin' },
      // A Node's name has the limits pairing puts on one.
      { v: 1, id: 'a', op: 'node.rename', nodeId: 'n1', label: '   ' },
      { v: 1, id: 'a', op: 'node.rename', nodeId: 'n1', label: 'x'.repeat(121) },
      // An account is a folder name and part of a shell line, so only its own grammar passes.
      ...['../other', 'Work', ''].map((account) => ({
        v: 1,
        id: 'a',
        op: 'session.create',
        nodeId: 'n1',
        taskId: 't1',
        providerId: 'p',
        profileId: 'p',
        account,
        key: 'k'.repeat(8),
      })),
      // A request is answered with a button or a form, never both, and never with a provider payload.
      resolve({ optionId: 'a', answers: {} }),
      resolve({ decision: 'accept' }),
      resolve({ optionId: '' }),
      resolve({ answers: { pick: 3 } }),
      resolve({ answers: Object.fromEntries(Array.from({ length: 51 }, (_, index) => [`q${index}`, 'x'])) }),
      { ...resolve({ optionId: 'a' }), key: 'short' },
      {
        v: 1,
        id: 'a',
        op: 'attachment.upload',
        nodeId: 'n1',
        taskId: 't1',
        filename: 'page.html',
        mediaType: 'text/html',
        data: 'PGh0bWw+',
      },
      {
        v: 1,
        id: 'a',
        op: 'attachment.upload',
        nodeId: 'n1',
        taskId: 't1',
        filename: 'big.png',
        mediaType: 'image/png',
        data: 'A'.repeat(14_000_000),
      },
      { v: 1, id: 'a', op: 'attachment.read', nodeId: 'n1', attachmentId: 'a1' },
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
