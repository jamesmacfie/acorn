import { describe, expect, it, vi } from 'vitest'
import type { ServerMsg } from '@acorn/plugin-terminal/contract/wire.ts'
import { sessionPty, type SessionPtyApi } from './sessionPty'

describe('raw terminal session channel', () => {
  it('attaches at the cell size and forwards input, output, resize and exit', async () => {
    let receive!: (message: ServerMsg) => void
    const detach = vi.fn()
    const api: SessionPtyApi = {
      attach: vi.fn((_id, on) => { receive = on; return detach }),
      write: vi.fn(),
      resize: vi.fn(async () => true),
    }
    const output = vi.fn()
    const exited = vi.fn()
    const error = vi.fn()
    const io = sessionPty(api, 'session-1', error, exited)
    const dispose = io.open({ cols: 80, rows: 18 }, output)

    expect(api.attach).toHaveBeenCalledWith('session-1', expect.any(Function), { cols: 80, rows: 18 })
    io.input('ls\r')
    expect(api.write).toHaveBeenCalledWith('session-1', 'ls\r')
    receive({ type: 'output', data: 'result' })
    expect(output).toHaveBeenCalledWith({ kind: 'out', data: 'result' })
    io.resize({ cols: 120, rows: 30 })
    expect(api.resize).toHaveBeenCalledWith('session-1', 120, 30)
    receive({ type: 'exit', exitCode: 0, signal: null })
    expect(output).toHaveBeenCalledWith({ kind: 'exit', code: 0 })
    expect(exited).toHaveBeenCalledOnce()
    dispose()
    expect(detach).toHaveBeenCalledOnce()
    expect(error).not.toHaveBeenCalled()
  })

  it('reports stream errors and rejected resize without losing the session', async () => {
    let receive!: (message: ServerMsg) => void
    const api: SessionPtyApi = {
      attach: (_id, on) => { receive = on; return () => {} },
      write: vi.fn(),
      resize: async () => { throw new Error('resize refused') },
    }
    const error = vi.fn()
    const io = sessionPty(api, 'session-2', error, vi.fn())
    io.open({ cols: 80, rows: 20 }, vi.fn())
    receive({ type: 'error', code: 'gone', message: 'channel unavailable' })
    expect(error).toHaveBeenCalledWith('channel unavailable')
    io.resize({ cols: 100, rows: 24 })
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('resize refused'))
  })

  it('reports a refused resize result', async () => {
    const api: SessionPtyApi = {
      attach: () => () => {}, write: vi.fn(), resize: async () => false,
    }
    const error = vi.fn()
    const io = sessionPty(api, 'session-3', error, vi.fn())
    io.resize({ cols: 80, rows: 24 })
    await vi.waitFor(() => expect(error).toHaveBeenCalledWith('The terminal did not accept the new size.'))
  })
})
