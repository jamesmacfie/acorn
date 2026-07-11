import { afterEach, describe, expect, it } from 'vitest'
import type { TerminalSession } from '../../../core/shared/terminal'
import { setTerminalBridge, type TerminalBridge } from '../server/routes/terminal'
import { TerminalSessionService } from './sessionService'

const SESSION: TerminalSession = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', taskId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', title: 'shell',
  kind: 'shell', profileId: 'shell', backend: 'node-pty', status: 'running', idle: false, agentState: 'unknown',
  isWorktree: true, cwd: '/w', command: 'zsh', cols: 120, rows: 40, createdAt: 1, exitCode: null,
}

function stubBridge(over: Partial<TerminalBridge> = {}): TerminalBridge {
  return {
    list: async () => [SESSION],
    profiles: async () => [],
    create: async (opts) => ({ ...SESSION, id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', taskId: opts.taskId, profileId: opts.profileId ?? 'shell' }),
    kill: async () => true,
    interrupt: async () => true,
    remove: async () => true,
    resize: async () => true,
    sendToAgent: async () => ({ ok: true, queued: false }),
    taskStatuses: async () => [],
    repoPathGet: async () => null,
    repoPathSet: async () => ({ ok: false, reason: 'x' }),
    repoPathRunTargets: async () => ({ ok: false, reason: 'x' }),
    previewUrl: async () => ({ ok: false }),
    onCreated: async () => {},
    useCheckout: async () => null,
    archive: async () => ({ ok: true }) as never,
    mcpInspect: async () => [{ file: '.mcp.json', servers: [{ name: 'srv', transport: 'stdio', status: 'enabled', command: 'x', env: { SECRET: 'shh' } }] }],
    mcpCreateStarter: async () => ({ ok: true }),
    ...over,
  }
}

describe('TerminalSessionService', () => {
  afterEach(() => setTerminalBridge(null))

  it('503s when the terminal engine is absent', async () => {
    setTerminalBridge(null)
    await expect(new TerminalSessionService().list({ limit: 50 })).rejects.toMatchObject({ code: 'capability_unavailable', status: 503 })
  })

  it('lists + creates sessions with a redacted command label', async () => {
    setTerminalBridge(stubBridge())
    const svc = new TerminalSessionService()
    const list = await svc.list({ limit: 50 })
    expect(list[0]).toMatchObject({ id: SESSION.id, commandLabel: 'shell' })
    expect(JSON.stringify(list)).not.toContain('"command"') // raw command never on the wire

    const created = await svc.create(SESSION.taskId, { launch: 'profile', profileId: 'claude-code', cols: 120, rows: 40 })
    expect(created.profileId).toBe('claude-code')
  })

  it('requires force to remove a running session', async () => {
    setTerminalBridge(stubBridge())
    const svc = new TerminalSessionService()
    await expect(svc.remove(SESSION.id, false)).rejects.toMatchObject({ code: 'session_running' })
    await expect(svc.remove(SESSION.id, true)).resolves.toBeUndefined()
  })

  it('inspects MCP config exposing env keys but not values', async () => {
    setTerminalBridge(stubBridge())
    const mcp = await new TerminalSessionService().mcpInspect(SESSION.taskId)
    expect(mcp.files[0].servers[0]).toMatchObject({ name: 'srv', envKeys: ['SECRET'] })
    expect(JSON.stringify(mcp)).not.toContain('shh') // secret value stripped
  })
})
