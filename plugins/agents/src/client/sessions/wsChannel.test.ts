import { afterEach, expect, it, vi } from 'vitest'

const transport = vi.hoisted(() => ({
  handler: null as ((frame: unknown) => void) | null,
  connect: vi.fn(),
  dispose: vi.fn(),
}))
vi.mock('@acorn/plugin-api/client', () => ({
  wsConnect: transport.connect,
  registerWsChannel: (_prefix: string, handler: (frame: unknown) => void) => {
    if (transport.handler) throw new Error('ws channel already registered: agent')
    transport.handler = handler
    return { dispose: () => { transport.handler = null; transport.dispose() } }
  },
}))

afterEach(() => {
  transport.handler = null
  vi.clearAllMocks()
  vi.resetModules()
})

it('can load a lazy surface again while the running plugin owns the agent channel', async () => {
  const running = await import('./wsChannel')
  const receive = vi.fn()
  const stop = running.wsOnAgentFrame(receive)
  vi.resetModules()

  await expect(import('./wsChannel')).resolves.toBeDefined()
  const frame = { channel: 'agent:session' }
  transport.handler!(frame)
  expect(receive).toHaveBeenCalledWith(frame)
  expect(transport.dispose).not.toHaveBeenCalled()
  stop()
})

it('holds one channel until the last subscriber leaves and can subscribe again', async () => {
  const { wsOnAgentFrame } = await import('./wsChannel')
  expect(transport.handler).toBeNull()
  const first = vi.fn()
  const second = vi.fn()
  const stopFirst = wsOnAgentFrame(first)
  const stopSecond = wsOnAgentFrame(second)
  const frame = { channel: 'agent:session' }
  transport.handler!(frame)
  expect(first).toHaveBeenCalledWith(frame)
  expect(second).toHaveBeenCalledWith(frame)

  stopFirst()
  expect(transport.dispose).not.toHaveBeenCalled()
  transport.handler!(frame)
  expect(first).toHaveBeenCalledTimes(1)
  expect(second).toHaveBeenCalledTimes(2)
  stopSecond()
  expect(transport.handler).toBeNull()
  expect(transport.dispose).toHaveBeenCalledTimes(1)

  const stopNext = wsOnAgentFrame(vi.fn())
  stopSecond()
  expect(transport.handler).not.toBeNull()
  stopNext()
  expect(transport.dispose).toHaveBeenCalledTimes(2)
})
