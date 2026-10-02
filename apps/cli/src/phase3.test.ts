import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { parseCliArgs } from './args'
import { runCommand } from './commands'
import type { CliNode } from './node'
import { readBounded } from './input'

const requestId = '123e4567-e89b-42d3-a456-426614174000'
const dirs: string[] = []
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
const jsonFile = (value: unknown) => {
  const dir = mkdtempSync(join(tmpdir(), 'acorn-cli-phase3-'))
  dirs.push(dir)
  const path = join(dir, 'input.json')
  writeFileSync(path, JSON.stringify(value))
  return path
}
type Call = { method: string; path: string; body: unknown; key: string }
function fakeNode(reads: Record<string, unknown>, write: (call: Call) => unknown): { node: CliNode; calls: Call[] } {
  const calls: Call[] = []
  return { calls, node: {
    nodeId: 'node-one', endpoint: 'https://node-one.test',
    async get(path) { if (!(path in reads)) throw new Error(`Unexpected read ${path}`); return reads[path] },
    async mutate(method, path, body, key) { const call = { method, path, body, key }; calls.push(call); return write(call) },
    close() {},
  } }
}

describe('Phase 3 core writes', () => {
  it('bounds file input and reports invalid UTF-8 before parsing', async () => {
    const oversized = jsonFile({ prompt: 'x'.repeat(100) })
    await expect(readBounded(oversized, 10)).rejects.toMatchObject({ code: 'input_too_large', exitCode: 2 })
    const invalid = jsonFile({})
    writeFileSync(invalid, Buffer.from([0xff]))
    await expect(readBounded(invalid, 10)).rejects.toMatchObject({ code: 'invalid_input', exitCode: 2 })
  })
  it('creates a workspace and project with explicit membership and keyed mutations', async () => {
    const { node, calls } = fakeNode({}, ({ path }) => path.endsWith('/workspaces')
      ? { id: 'workspace-one', name: 'Platform', isDefault: false, sort: 1, projects: [] }
      : { project: { id: 'project-one', name: 'API', workspaceId: 'workspace-one', path: '/srv/api', hidden: false, vcs: null, defaultBranch: null, remoteUrl: null } })
    const workspace = await runCommand(node, parseCliArgs(['workspace', 'create', '--name', 'Platform', '--request-id', requestId]))
    const project = await runCommand(node, parseCliArgs(['project', 'add', '--workspace', 'workspace-one', '--path', '/srv/api', '--request-id', requestId]))
    expect(workspace).toMatchObject({ kind: 'Workspace', id: 'workspace-one' })
    expect(project).toMatchObject({ kind: 'Project', workspaceId: 'workspace-one' })
    expect(calls).toMatchObject([{ method: 'POST', body: { name: 'Platform' }, key: requestId }, { method: 'POST', body: { path: '/srv/api', workspaceId: 'workspace-one' }, key: requestId }])
  })

  it('rejects unsafe mapping replacement and unknown config fields before dispatch', async () => {
    const { node, calls } = fakeNode({ '/v1/core/workspaces': [{ id: 'w', name: 'W', isDefault: false, sort: 0, projects: [] }] }, () => ({}))
    await expect(runCommand(node, parseCliArgs(['workspace', 'external-projects', 'replace', 'w', '--file', jsonFile({})]))).rejects.toMatchObject({ exitCode: 2 })
    await expect(runCommand(node, parseCliArgs(['project', 'config', 'set', 'p', '--patch-file', jsonFile({ setupScrit: 'echo hi' })]))).rejects.toMatchObject({ exitCode: 2 })
    await expect(runCommand(node, parseCliArgs(['project', 'add', '--workspace', 'w', '--path', 'relative']))).rejects.toMatchObject({ exitCode: 2 })
    expect(calls).toEqual([])
  })

  it.each([
    [[], {}],
    [['--base', 'feature/parent'], { branch: 'review-api', branchSource: 'derived', baseBranch: 'feature/parent' }],
    [['--branch', 'Review/API', '--base', 'feature/parent'], { branch: 'Review/API', branchSource: 'exact', baseBranch: 'feature/parent' }],
  ])('sends the branch source and base for %j', async (options, expected) => {
    const { node, calls } = fakeNode({}, () => ({ id: 't', projectId: 'p', title: 'Review API', status: 'active', branch: null }))
    await runCommand(node, parseCliArgs(['task', 'create', '--project', 'p', '--title', 'Review API', ...options]))
    expect(calls[0]!.body).toEqual({ projectId: 'p', title: 'Review API', origin: 'local', skipSetup: false, ...expected })
  })

  it('returns an inspectable task when the on-created hook fails, with stable step keys', async () => {
    const row = { id: 'task-one', projectId: 'project-one', title: 'Review', status: 'active', branch: null, worktreePath: null, parentId: null }
    const { node, calls } = fakeNode({}, ({ path }) => {
      if (path === '/v1/core/tasks') return row
      throw new Error('setup unavailable')
    })
    await expect(runCommand(node, parseCliArgs(['task', 'create', '--project', 'project-one', '--title', 'Review', '--request-id', requestId]))).rejects.toMatchObject({
      code: 'partial_task_create', exitCode: 7, partial: { kind: 'Task', id: 'task-one' },
    })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.key).not.toBe(calls[1]!.key)
    expect(calls[0]!.body).toMatchObject({ origin: 'local', projectId: 'project-one' })
    expect(calls[1]!.path).toBe('/v1/core/tasks/task-one/on-created')
  })

  it('retries only the task setup step with the same request ID after partial creation', async () => {
    const row = { id: 'task-one', projectId: 'project-one', title: 'Review', origin: 'local', status: 'active', branch: null, worktreePath: null, parentId: null }
    let hookCalls = 0
    const { node, calls } = fakeNode({}, ({ path }) => {
      if (path === '/v1/core/tasks') return row
      if (++hookCalls === 1) throw new Error('temporary failure')
      return { ok: true }
    })
    const args = parseCliArgs(['task', 'create', '--project', 'project-one', '--title', 'Review', '--request-id', requestId])
    await expect(runCommand(node, args)).rejects.toMatchObject({ code: 'partial_task_create' })
    expect(await runCommand(node, args)).toMatchObject({ kind: 'Task', id: 'task-one', origin: 'local', branch: null })
    expect(calls[0]!.key).toBe(calls[2]!.key)
    expect(calls[1]!.key).toBe(calls[3]!.key)
  })
})

describe('Phase 3 managed agents', () => {
  const provider = { id: 'codex', profileId: 'codex', label: 'Codex', installed: true, authenticated: true, driverKind: 'codex-app-server', diagnostics: [] }
  const session = { id: 'session-one', taskId: 'task-one', providerId: 'codex', profileId: 'codex', kind: 'interactive', title: 'Agent', runtimeState: 'working', attention: 'none', lastEventSeq: 1, queuedTurns: 1, createdAt: 1, updatedAt: 2 }

  it('starts one session and one turn with separate stable keys', async () => {
    const { node, calls } = fakeNode({ '/v1/p/agents/providers': [provider], '/v1/p/agents/sessions?taskId=task-one&archived=false&limit=1': { sessions: [] } }, ({ path }) => path.endsWith('/turns')
      ? { id: 'turn-one', sessionId: 'session-one', ordinal: 0, status: 'queued' } : session)
    const result = await runCommand(node, parseCliArgs(['agent', 'start', '--task', 'task-one', '--profile', 'codex', '--prompt-file', jsonFile('Review API'), '--request-id', requestId]))
    expect(result).toMatchObject({ kind: 'AgentSession', id: 'session-one', firstTurnId: 'turn-one' })
    expect(calls).toHaveLength(2)
    expect(calls[0]!.key).not.toBe(calls[1]!.key)
    expect(calls[1]!.body).toMatchObject({ input: [{ type: 'text' }] })
  })

  it('keeps a created session inspectable if first-turn enqueue fails', async () => {
    const { node } = fakeNode({ '/v1/p/agents/providers': [provider], '/v1/p/agents/sessions?taskId=task-one&archived=false&limit=1': { sessions: [] } }, ({ path }) => {
      if (path.endsWith('/turns')) throw new Error('unavailable')
      return session
    })
    await expect(runCommand(node, parseCliArgs(['agent', 'start', '--task', 'task-one', '--profile', 'codex', '--prompt', 'Review API', '--request-id', requestId]))).rejects.toMatchObject({
      code: 'partial_agent_start', exitCode: 7, partial: { kind: 'AgentSession', id: 'session-one', firstTurnStatus: 'unconfirmed' },
    })
  })

  it('retries the same session and first turn after a partial agent start', async () => {
    let enqueue = 0
    const { node, calls } = fakeNode({ '/v1/p/agents/providers': [provider], '/v1/p/agents/sessions?taskId=task-one&archived=false&limit=1': { sessions: [] } }, ({ path }) => {
      if (!path.endsWith('/turns')) return session
      if (++enqueue === 1) throw new Error('temporary failure')
      return { id: 'turn-one', sessionId: 'session-one', ordinal: 0, status: 'queued' }
    })
    const args = parseCliArgs(['agent', 'start', '--task', 'task-one', '--profile', 'codex', '--prompt', 'Review API', '--request-id', requestId])
    await expect(runCommand(node, args)).rejects.toMatchObject({ code: 'partial_agent_start' })
    expect(await runCommand(node, args)).toMatchObject({ kind: 'AgentSession', id: 'session-one', firstTurnId: 'turn-one' })
    expect(calls[0]!.key).toBe(calls[2]!.key)
    expect(calls[1]!.key).toBe(calls[3]!.key)
  })

  it('preserves failed checked waits as output and exit 6', async () => {
    const snapshot = { session: { ...session, runtimeState: 'failed', attention: 'error' }, turns: [{ id: 'turn-one', sessionId: 'session-one', ordinal: 0, status: 'failed' }], events: [], requests: [] }
    const { node } = fakeNode({ '/v1/p/agents/sessions/session-one': snapshot }, () => ({}))
    await expect(runCommand(node, parseCliArgs(['agent', 'wait', 'session-one', '--check']))).rejects.toMatchObject({ exitCode: 6, partial: { lastTurnStatus: 'failed' } })
  })

  it('checks the latest turn after an earlier failed turn was retried', async () => {
    const snapshot = { session: { ...session, runtimeState: 'ready' }, turns: [
      { id: 'turn-one', sessionId: 'session-one', ordinal: 0, status: 'failed' },
      { id: 'turn-two', sessionId: 'session-one', ordinal: 1, status: 'completed' },
    ], events: [], requests: [] }
    const { node } = fakeNode({ '/v1/p/agents/sessions/session-one': snapshot }, () => ({}))
    expect(await runCommand(node, parseCliArgs(['agent', 'wait', 'session-one', '--check']))).toMatchObject({ lastTurnId: 'turn-two', lastTurnStatus: 'completed' })
  })

  it('returns attention distinctly and bounds an unfinished wait', async () => {
    const attention = { session: { ...session, attention: 'permission' }, turns: [], events: [], requests: [{ status: 'pending' }] }
    const { node: attentionNode } = fakeNode({ '/v1/p/agents/sessions/session-one': attention }, () => ({}))
    expect(await runCommand(attentionNode, parseCliArgs(['agent', 'wait', 'session-one', '--until', 'attention']))).toMatchObject({ attention: 'permission', pendingRequests: 1 })
    const pending = { session, turns: [{ id: 'turn-one', sessionId: 'session-one', ordinal: 0, status: 'active' }], events: [], requests: [] }
    const { node: pendingNode } = fakeNode({ '/v1/p/agents/sessions/session-one': pending, '/v1/p/agents/sessions/session-one/wait?afterSeq=1&until=turn_completed&timeoutMs=0': pending }, () => ({}))
    await expect(runCommand(pendingNode, parseCliArgs(['agent', 'wait', 'session-one', '--timeout', '0']))).rejects.toMatchObject({ exitCode: 5, partial: { lastTurnStatus: 'active' } })
  })

  it('resumes durable event pages across a sequence gap', async () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const { node } = fakeNode({
        '/v1/p/agents/sessions/session-one/events?afterSeq=1&limit=2': { events: [
          { id: 'e2', sessionId: 'session-one', turnId: null, seq: 2, event: { type: 'session_state' }, createdAt: 1 },
          { id: 'e3', sessionId: 'session-one', turnId: null, seq: 3, event: { type: 'session_state' }, createdAt: 1 },
        ], nextCursor: 3 },
        '/v1/p/agents/sessions/session-one/events?afterSeq=3&limit=2': { events: [
          { id: 'e5', sessionId: 'session-one', turnId: null, seq: 5, event: { type: 'turn_completed' }, createdAt: 2 },
        ], nextCursor: null },
      }, () => ({}))
      expect(await runCommand(node, parseCliArgs(['agent', 'events', 'session-one', '--after-seq', '1', '--limit', '2', '--output', 'json']))).toMatchObject([{ seq: 2 }, { seq: 3 }, { seq: 5 }])
      expect(stderr).toHaveBeenCalledWith(expect.stringContaining('skip from sequence'))
    } finally { stderr.mockRestore() }
  })

  it('rejects commands that would consume stdin twice before reading it', async () => {
    const { node } = fakeNode({}, () => ({}))
    await expect(runCommand(node, parseCliArgs(['agent', 'start', '--task', '-', '--profile', 'codex', '--prompt-file', '-']))).rejects.toMatchObject({ exitCode: 2 })
  })
})
