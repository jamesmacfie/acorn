import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnMock = vi.fn()
vi.mock('node:child_process', () => ({ spawn: spawnMock }))

describe('JsonRpcProcess', () => {
  beforeEach(() => spawnMock.mockReset())

  it('correlates responses and forwards server requests', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, killed: false, kill: vi.fn() })
    spawnMock.mockReturnValue(child)
    const serverRequests: unknown[] = []
    const { JsonRpcProcess } = await import('./jsonRpcProcess')
    const rpc = new JsonRpcProcess({
      command: 'agent',
      args: [],
      cwd: '/tmp',
      env: {},
      onRequest: (request) => serverRequests.push(request),
    })
    const request = rpc.request<{ ok: boolean }>('thread/start')
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })}\n`)
    expect(await request).toEqual({ ok: true })
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: 'approve-1', method: 'approval', params: { command: 'git status' } })}\n`)
    expect(serverRequests).toEqual([{ id: 'approve-1', method: 'approval', params: { command: 'git status' } }])
    await rpc.stop()
  })

  it('bounds one protocol message rather than cumulative process output', async () => {
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr, killed: false, kill: vi.fn() })
    spawnMock.mockReturnValue(child)
    const closed: Error[] = []
    const { JsonRpcProcess } = await import('./jsonRpcProcess')
    const rpc = new JsonRpcProcess({
      command: 'agent',
      args: [],
      cwd: '/tmp',
      env: {},
      maxBufferedBytes: 80,
      onClosed: (error) => {
        if (error) closed.push(error)
      },
    })
    for (let index = 0; index < 20; index++) {
      stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'tick', params: { index } })}\n`)
    }
    expect(rpc.closed).toBe(false)
    stdout.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'oversized', params: { text: 'x'.repeat(100) } })}\n`)
    expect(rpc.closed).toBe(true)
    expect(closed[0]?.message).toContain('message exceeded')
  })
})
