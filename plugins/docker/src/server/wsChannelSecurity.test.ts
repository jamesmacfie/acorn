import { beforeEach, expect, it, vi } from 'vitest'
import type { CompiledPluginBroadcast } from '@acorn/plugin-api/node'
import type { WsClientFrame } from '@acorn/protocol/ws.ts'
import { registerDockerWsChannel } from './wsChannel'
import { MAX_DOCKER_INPUT_BYTES } from './wsFramePolicy'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), openStream: vi.fn() }))
vi.mock('node-pty', () => ({ spawn: mocks.spawn }))
vi.mock('./dockerService', () => ({ getDockerService: () => ({ openStream: mocks.openStream }) }))
vi.mock('./cli', () => ({ dockerEnv: () => ({}) }))

type Channel = Parameters<CompiledPluginBroadcast['channel']>[1]
let channel: Channel
const conn = {}
const send = vi.fn()
const pty = () => ({ write: vi.fn(), resize: vi.fn(), kill: vi.fn(), onData: vi.fn(), onExit: vi.fn() })
const dispatch = (frame: WsClientFrame) => channel.onFrame(frame, send, conn)
const open = (id: string) => dispatch({ channel: 'docker:exec:open', execId: id, ref: 'container' })

beforeEach(() => {
  vi.clearAllMocks()
  registerDockerWsChannel({ send, channel: (_prefix: string, handler: Channel) => { channel = handler; return () => {} } } as unknown as CompiledPluginBroadcast)
})

it('validates every native frame before operation and retains defaults and clamping', () => {
  const native = pty()
  mocks.spawn.mockReturnValue(native)
  open('e1')
  expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ cols: 80, rows: 24 })
  for (const frame of [
    { channel: 'docker:exec:in', execId: 'e1', data: {} },
    { channel: 'docker:exec:in', execId: {}, data: 'x' },
    { channel: 'docker:exec:in', execId: 'e1', data: 'é'.repeat(MAX_DOCKER_INPUT_BYTES / 2 + 1) },
    { channel: 'docker:exec:resize', execId: 'e1', cols: 'NaN', rows: 24 },
    { channel: 'docker:exec:resize', execId: 'e1', cols: 1.5, rows: 24 },
    { channel: 'docker:exec:kill', execId: {} },
    { channel: 'docker:exec:open', execId: 'x'.repeat(129), ref: 'container' },
  ]) dispatch(frame)
  expect(native.write).not.toHaveBeenCalled()
  expect(native.resize).not.toHaveBeenCalled()
  expect(native.kill).not.toHaveBeenCalled()
  expect(mocks.spawn).toHaveBeenCalledOnce()
  dispatch({ channel: 'docker:exec:in', execId: 'e1', data: 'hello' })
  dispatch({ channel: 'docker:exec:resize', execId: 'e1', cols: 900, rows: -10 })
  expect(native.write).toHaveBeenCalledWith('hello')
  expect(native.resize).toHaveBeenCalledWith(500, 2)
})

it('contains native failures and continues teardown for other execs and streams', () => {
  const first = pty()
  const second = pty()
  first.write.mockImplementation(() => { throw new Error('exited') })
  first.resize.mockImplementation(() => { throw new Error('exited') })
  first.kill.mockImplementation(() => { throw new Error('exited') })
  mocks.spawn.mockReturnValueOnce(first).mockReturnValueOnce(second)
  open('e1'); open('e2')
  expect(() => dispatch({ channel: 'docker:exec:in', execId: 'e1', data: 'hello' })).not.toThrow()
  expect(() => dispatch({ channel: 'docker:exec:resize', execId: 'e1', cols: 80, rows: 24 })).not.toThrow()
  expect(() => dispatch({ channel: 'docker:exec:kill', execId: 'e1' })).not.toThrow()
  const stop = vi.fn(() => { throw new Error('already stopped') })
  mocks.openStream.mockReturnValue({ stop })
  dispatch({ channel: 'docker:logs:attach', id: 'container' })
  expect(() => channel.onDisconnect(conn)).not.toThrow()
  expect(second.kill).toHaveBeenCalledOnce()
  expect(stop).toHaveBeenCalledOnce()
})
