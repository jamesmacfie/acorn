import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { TokenService } from '../../server/publicApi/tokenService'
import { makeTestDb, type TestDb } from '../../server/routes/testDb'
import { setStreamHandlers, type StreamSink } from '../wsHub'
import type { TerminalSession } from '../../shared/terminal'
import { AutomationApiServer } from './server'
import { ApiSettingsStore } from './settingsStore'

const PORT = 47320

function runtimeInfo() {
  return {
    version: '9.9.9', startedAt: 1000, desktop: true,
    reconciliationComplete: () => true, rendererConnected: () => false,
    terminalAvailable: () => false, worktreesAvailable: () => false,
    pluginCapabilities: () => [],
  }
}

// Buffer frames from construction so none are missed between events (the ready frame arrives
// immediately after the handshake).
class Frames {
  private queue: Record<string, unknown>[] = []
  private waiter: ((f: Record<string, unknown>) => void) | null = null
  constructor(ws: WebSocket) {
    ws.on('message', (d) => {
      const frame = JSON.parse(d.toString())
      if (this.waiter) {
        this.waiter(frame)
        this.waiter = null
      } else this.queue.push(frame)
    })
  }
  next(): Promise<Record<string, unknown>> {
    const buffered = this.queue.shift()
    if (buffered) return Promise.resolve(buffered)
    return new Promise((resolve) => (this.waiter = resolve))
  }
}

describe('public WebSocket hub', () => {
  let dir: string
  let t: TestDb
  let tokens: TokenService
  let token: string
  let tokenId: string
  let server: AutomationApiServer

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'acorn-ws-'))
    t = makeTestDb()
    tokens = new TokenService(t.db)
    const created = await tokens.create({ userId: 'u', name: 'w', scopes: ['read', 'write'], expiresAt: null })
    token = created.token
    tokenId = created.metadata.id
    const store = new ApiSettingsStore(dir, {})
    store.write({ enabled: true, port: PORT })
    server = new AutomationApiServer({
      settingsStore: store, bindings: { DB: t.db } as unknown as Env, tokens, version: '9.9.9', runtime: runtimeInfo(),
    })
    await server.start()
  })
  afterEach(async () => {
    await server.stop()
    t.cleanup()
    rmSync(dir, { recursive: true, force: true })
  })

  const connect = () => new WebSocket(`ws://127.0.0.1:${PORT}/api/v1/ws`, { headers: { authorization: `Bearer ${token}` } })

  it('rejects an upgrade with no bearer', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/v1/ws`)
    const err = await new Promise<Error>((resolve) => ws.once('error', resolve))
    expect(err.message).toMatch(/401/)
  })

  it('sends ready, acks a subscribe, and delivers a matching event', async () => {
    const ws = connect()
    const frames = new Frames(ws)
    await new Promise((r) => ws.once('open', r))
    const ready = await frames.next()
    expect(ready.type).toBe('ready')
    expect(ready.scopes).toEqual(['read', 'write'])

    ws.send(JSON.stringify({ version: 1, id: 'c1', type: 'subscribe', subscriptionId: 's1', filter: { channels: ['core.task.created'] } }))
    const ack = await frames.next()
    expect(ack).toMatchObject({ type: 'ack', requestId: 'c1' })

    server.bus.publishAs({ kind: 'system' }, { channel: 'core.task.created', data: { id: 't1' }, taskId: 't1' })
    const event = await frames.next()
    expect(event).toMatchObject({ type: 'event', subscriptionId: 's1', channel: 'core.task.created', data: { id: 't1' } })
    ws.close()
  })

  it('rejects an unknown frame with a correlated error', async () => {
    const ws = connect()
    const frames = new Frames(ws)
    await new Promise((r) => ws.once('open', r))
    await frames.next() // ready
    ws.send(JSON.stringify({ version: 1, id: 'x1', type: 'bogus' }))
    const err = await frames.next()
    expect(err.type).toBe('error')
    ws.close()
  })

  it('streams terminal output on attach and accepts input with write scope', async () => {
    const SESSION = { id: 's1', taskId: 't1', title: 'shell', kind: 'shell', profileId: 'shell', backend: 'node-pty', status: 'running', idle: false, agentState: 'unknown', isWorktree: true, cwd: '/w', command: 'zsh', cols: 80, rows: 24, createdAt: 1, exitCode: null } as TerminalSession
    const inputs: string[] = []
    setStreamHandlers({
      attach: (_id: string, sink: StreamSink) => {
        sink({ type: 'ready', session: SESSION, replayed: false })
        sink({ type: 'output', data: 'hello\n' })
      },
      detach: () => {},
      input: (id: string, data: string) => inputs.push(`${id}:${data}`),
    })
    try {
      const ws = connect()
      const frames = new Frames(ws)
      await new Promise((r) => ws.once('open', r))
      await frames.next() // ready (connection)
      ws.send(JSON.stringify({ version: 1, id: 'a1', type: 'terminal.attach', sessionId: '00000000-0000-4000-8000-000000000001' }))
      const ready = await frames.next()
      expect(ready.type).toBe('terminal.ready')
      const output = await frames.next()
      expect(output).toMatchObject({ type: 'terminal.output', data: 'hello\n' })
      const attachAck = await frames.next()
      expect(attachAck).toMatchObject({ type: 'ack', requestId: 'a1' })

      ws.send(JSON.stringify({ version: 1, id: 'i1', type: 'terminal.input', sessionId: '00000000-0000-4000-8000-000000000001', data: 'ls\n' }))
      const inputAck = await frames.next()
      expect(inputAck).toMatchObject({ type: 'ack', requestId: 'i1' })
      expect(inputs.some((i) => i.endsWith(':ls\n'))).toBe(true)
      ws.close()
    } finally {
      setStreamHandlers(null)
    }
  })

  it('closes a socket when its token is revoked', async () => {
    const ws = connect()
    const frames = new Frames(ws)
    await new Promise((r) => ws.once('open', r))
    await frames.next() // ready
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)))
    await tokens.revoke('u', tokenId)
    expect(await closed).toBe(4401)
  })
})
