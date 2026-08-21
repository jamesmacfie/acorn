import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolError } from './registry'
import {
  _resetPluginRequests,
  decidePluginRequest,
  pendingPluginRequests,
  pluginRequestTool,
  raisePluginRequest,
} from './pluginRequests'

// The one agent tool that can put third-party code on a node, and the thing worth asserting is what
// it cannot do: every test below is a variation on "the tool raises a question, and only a device
// answering it makes anything happen" (docs/agent-tools.md § plugin_request).

const ctx = { taskId: 'task-1', userLogin: 'owner' }

const call = async (tool: ReturnType<typeof pluginRequestTool>, args: Record<string, unknown>) =>
  await tool.handler(tool.input.parse(args), ctx)

beforeEach(() => _resetPluginRequests())

describe('the tool cannot install', () => {
  it('imports nothing that could install, download or write to disk', () => {
    // Structural, not behavioural: the request/decision split is only a defence for as long as this
    // module has no installer in reach. A future import of pluginInstaller here would give a
    // prompt-injected agent a code path to arbitrary code execution, and no test written against the
    // handler's output would notice.
    const source = readFileSync(new URL('./pluginRequests.ts', import.meta.url), 'utf8')
    const imports = [...source.matchAll(/^import[^\n]*from '([^']+)'/gm)].map((match) => match[1])
    expect(imports).toEqual(['node:crypto', 'zod', './registry.ts', '@acorn/protocol/api.ts'])
  })

  it('raises a pending request and refuses the call, rather than doing anything', async () => {
    const notify = vi.fn()
    const tool = pluginRequestTool(notify)
    await expect(call(tool, { action: 'install', source: { github: 'acorn/board' } })).rejects.toMatchObject({
      name: 'ToolError',
      kind: 'needs-trust',
    })
    expect(pendingPluginRequests()).toMatchObject([{ taskId: 'task-1', action: 'install', source: { github: 'acorn/board' }, dev: false }])
    expect(notify).toHaveBeenCalledWith('task-1', 'install')
  })

  it('is on the highest risk tier, so the owner’s execute switch turns it off with everything else', () => {
    expect(pluginRequestTool().risk).toBe('execute')
    // Never projected to the renderer: the shell has Settings → Plugins for this, and a renderer-callable
    // copy would be a second, unaudited way to reach the same queue.
    expect(pluginRequestTool().exposeToRenderer).toBeUndefined()
  })
})

describe('one ask is one question', () => {
  it('rings the bell once, however many times the agent polls', async () => {
    const notify = vi.fn()
    const tool = pluginRequestTool(notify)
    const args = { action: 'install', source: { npm: 'acorn-board' } }
    await expect(call(tool, args)).rejects.toThrow()
    await expect(call(tool, args)).rejects.toThrow()
    await expect(call(tool, args)).rejects.toThrow()
    expect(notify).toHaveBeenCalledTimes(1)
    expect(pendingPluginRequests()).toHaveLength(1)
  })

  it('does not treat a reordered source as a new question', () => {
    const first = raisePluginRequest({ taskId: 't', action: 'install', dev: false, source: { github: 'a/b', tag: 'v1' } })
    const second = raisePluginRequest({ taskId: 't', action: 'install', dev: false, source: { tag: 'v1', github: 'a/b' } as never })
    expect(second.request.requestId).toBe(first.request.requestId)
  })

  it('treats a dev-mode install as a different question from a plain one', () => {
    const plain = raisePluginRequest({ taskId: 't', action: 'install', dev: false, source: { path: '/tmp/board' } })
    const dev = raisePluginRequest({ taskId: 't', action: 'install', dev: true, source: { path: '/tmp/board' } })
    expect(dev.request.requestId).not.toBe(plain.request.requestId)
  })
})

describe('the owner’s answer', () => {
  it('hands an approval to the agent exactly once, then forgets it', async () => {
    const tool = pluginRequestTool()
    const args = { action: 'install', source: { github: 'acorn/board' } }
    await expect(call(tool, args)).rejects.toThrow()
    const [pending] = pendingPluginRequests()
    decidePluginRequest(pending.requestId, { decision: 'approved', message: 'board 1.0.0 is installed.' })

    expect(await call(tool, args)).toEqual({ state: 'approved', message: 'board 1.0.0 is installed.' })
    // Spent (docs/plugins.md § Approval-mediated install): a second identical call is a new question,
    // not a second use of the yes already given.
    await expect(call(tool, args)).rejects.toMatchObject({ kind: 'needs-trust' })
    expect(pendingPluginRequests()).toHaveLength(1)
  })

  it('returns a clean refusal on a denial, and nothing is left pending', async () => {
    const tool = pluginRequestTool()
    const args = { action: 'install', source: { url: 'https://example.test/acorn-plugin.tgz' } }
    await expect(call(tool, args)).rejects.toThrow()
    const [pending] = pendingPluginRequests()
    decidePluginRequest(pending.requestId, { decision: 'denied', message: 'The owner declined this install.' })

    expect(await call(tool, args)).toEqual({ state: 'denied', message: 'The owner declined this install.' })
    expect(pendingPluginRequests()).toEqual([])
  })

  it('refuses a second answer to the same request', () => {
    const raised = raisePluginRequest({ taskId: 't', action: 'uninstall', dev: false, pluginId: 'board' })
    expect(decidePluginRequest(raised.request.requestId, { decision: 'approved', message: 'gone' })).not.toBeNull()
    expect(decidePluginRequest(raised.request.requestId, { decision: 'denied', message: 'no' })).toBeNull()
  })

  it('refuses an answer to a request that never existed', () => {
    expect(decidePluginRequest('made-up', { decision: 'approved', message: 'yes' })).toBeNull()
  })
})

describe('shape and bounds', () => {
  const tool = pluginRequestTool()

  it('refuses an install with no source and an update with no id', async () => {
    await expect(call(tool, { action: 'install' })).rejects.toMatchObject({ kind: 'bad_request' })
    await expect(call(tool, { action: 'update' })).rejects.toMatchObject({ kind: 'bad_request' })
    await expect(call(tool, { action: 'uninstall' })).rejects.toMatchObject({ kind: 'bad_request' })
    expect(pendingPluginRequests()).toEqual([])
  })

  it('refuses a request that names both a source and an id', async () => {
    await expect(call(tool, { action: 'install', source: { npm: 'x' }, pluginId: 'y' })).rejects.toMatchObject({ kind: 'bad_request' })
    await expect(call(tool, { action: 'update', pluginId: 'y', source: { npm: 'x' } })).rejects.toMatchObject({ kind: 'bad_request' })
  })

  it('caps the agent’s reason, which is text a model wrote while reading who-knows-what', () => {
    expect(tool.input.safeParse({ action: 'uninstall', pluginId: 'board', reason: 'x'.repeat(401) }).success).toBe(false)
    expect(tool.input.safeParse({ action: 'uninstall', pluginId: 'board', reason: 'x'.repeat(400) }).success).toBe(true)
  })

  it('stops one agent from filling the owner’s queue', async () => {
    for (let i = 0; i < 20; i++) await expect(call(tool, { action: 'uninstall', pluginId: `p${i}` })).rejects.toMatchObject({ kind: 'needs-trust' })
    await expect(call(tool, { action: 'uninstall', pluginId: 'one-too-many' })).rejects.toMatchObject({ kind: 'failed' })
    expect(pendingPluginRequests()).toHaveLength(20)
  })

  it('classifies a domain refusal as ToolError, which is what the route maps to a status', async () => {
    await expect(call(tool, { action: 'install' })).rejects.toBeInstanceOf(ToolError)
  })
})
