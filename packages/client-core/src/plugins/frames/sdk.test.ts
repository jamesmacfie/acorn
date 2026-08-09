import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
import { AcornBridgeError, connect, _resetConnection, type AcornBridge } from './sdk'

// The SDK runs inside a frame, so there is no window here to run it in: the suite is plain Node
// (packages/client-core/vitest.config.ts). What it needs is exactly what a frame gives it — something
// to hear one `message` event on, and a port. Both are stubbed; the port is a real MessageChannel.

type Hello = { data: unknown; ports: MessagePort[] }

let windowListeners: ((event: Hello) => void)[] = []
let channel: MessageChannel
// Everything the frame sent, in order.
let sent: Record<string, unknown>[] = []

const HELLO = { acornBridge: 1 }
const CONTEXT: PluginFrameContext = { surface: 'board', target: 'pane', nodeId: 'node-a', theme: 'dark', style: 'terminal' }

// A stand-in host: replies to whatever the frame asks with whatever the test told it to.
const host = (reply: (message: Record<string, unknown>) => unknown) => {
  channel.port1.onmessage = (event: MessageEvent) => {
    const message = event.data as Record<string, unknown>
    sent.push(message)
    const answer = reply(message)
    if (answer !== undefined) channel.port1.postMessage(answer)
  }
}

const push = (message: unknown) => channel.port1.postMessage(message)

const handshake = async (context = CONTEXT): Promise<AcornBridge> => {
  const connecting = connect()
  // The frame's own `window.postMessage` from the host, port transferred alongside.
  for (const listener of windowListeners) listener({ data: HELLO, ports: [channel.port2 as unknown as MessagePort] })
  push({ kind: 'ready', context })
  return connecting
}

beforeEach(() => {
  _resetConnection()
  windowListeners = []
  sent = []
  channel = new MessageChannel()
  vi.stubGlobal('addEventListener', (type: string, listener: (event: Hello) => void) => {
    if (type === 'message') windowListeners.push(listener)
  })
  vi.stubGlobal('removeEventListener', (type: string, listener: (event: Hello) => void) => {
    if (type === 'message') windowListeners = windowListeners.filter((entry) => entry !== listener)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  channel.port1.close()
  channel.port2.close()
  _resetConnection()
})

describe('connect', () => {
  it('resolves on the handshake and exposes the frame context', async () => {
    host(() => undefined)
    const acorn = await handshake()
    expect(acorn.context).toEqual(CONTEXT)
  })

  it('ignores a message that is not the versioned hello', async () => {
    host(() => undefined)
    const connecting = connect()
    for (const listener of windowListeners) {
      listener({ data: { acornBridge: 99 }, ports: [channel.port2 as unknown as MessagePort] })
      // A hello with no port is not a handshake either.
      listener({ data: HELLO, ports: [] })
    }
    const settled = await Promise.race([connecting.then(() => 'connected'), new Promise((r) => setTimeout(() => r('waiting'), 20))])
    expect(settled).toBe('waiting')
  })

  it('returns the same connection to every caller', async () => {
    host(() => undefined)
    const acorn = await handshake()
    expect(await connect()).toBe(acorn)
  })
})

describe('api calls', () => {
  it('correlates the reply to the request', async () => {
    host((message) => (message.kind === 'api' ? { id: message.id, ok: true, status: 200, body: { tasks: [] } } : undefined))
    const acorn = await handshake()
    await expect(acorn.api.get('/v2/core/tasks')).resolves.toEqual({ tasks: [] })
    expect(sent.at(-1)).toMatchObject({ kind: 'api', method: 'GET', path: '/v2/core/tasks' })
  })

  it('answers two overlapping calls in the right order', async () => {
    const answers = new Map<number, unknown>()
    host((message) => {
      answers.set(message.id as number, message.path)
      return undefined
    })
    const acorn = await handshake()
    const first = acorn.api.get<string>('/a')
    const second = acorn.api.get<string>('/b')
    await new Promise((r) => setTimeout(r, 5)) // both requests have reached the host
    // Answered out of order on purpose: correlation is by id, not by arrival.
    for (const [id, path] of [...answers].reverse()) push({ id, ok: true, status: 200, body: path })
    expect(await Promise.all([first, second])).toEqual(['/a', '/b'])
  })

  it('throws the host’s error envelope as an AcornBridgeError', async () => {
    host((message) =>
      message.kind === 'api'
        ? { id: message.id, ok: false, error: { code: 'plugin_scope_denied', message: 'missing scope core.tasks:read', requestId: 'r1', retryable: false } }
        : undefined,
    )
    const acorn = await handshake()
    const error = await acorn.api.get('/v2/core/tasks').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(AcornBridgeError)
    expect(error).toMatchObject({ code: 'plugin_scope_denied', retryable: false, message: 'missing scope core.tasks:read' })
  })

  it('sends a body only when there is one', async () => {
    host((message) => (message.kind === 'api' ? { id: message.id, ok: true, status: 200, body: null } : undefined))
    const acorn = await handshake()
    await acorn.api.post('/v2/p/board/cards')
    expect(sent.at(-1)).not.toHaveProperty('body')
    await acorn.api.post('/v2/p/board/cards', { title: 'x' })
    expect(sent.at(-1)).toMatchObject({ body: { title: 'x' } })
  })

  it('cancels on an AbortSignal and rejects locally', async () => {
    host(() => undefined) // never answers
    const acorn = await handshake()
    const controller = new AbortController()
    const call = acorn.api.get('/v2/core/tasks', { signal: controller.signal })
    controller.abort()
    await expect(call).rejects.toBeDefined()
    await new Promise((r) => setTimeout(r, 5))
    expect(sent.at(-1)).toMatchObject({ kind: 'cancel' })
  })

  it('rejects immediately for a signal that is already aborted', async () => {
    host(() => undefined)
    const acorn = await handshake()
    await expect(acorn.api.get('/x', { signal: AbortSignal.abort() })).rejects.toBeDefined()
  })
})

describe('events', () => {
  it('subscribes once per channel and fans out locally', async () => {
    host((message) => (message.kind === 'subscribe' ? { id: message.id, ok: true, status: 200, body: null } : undefined))
    const acorn = await handshake()
    const first = vi.fn()
    const second = vi.fn()
    const off = acorn.events.on('runtime:task-archived', first)
    acorn.events.on('runtime:task-archived', second)
    await new Promise((r) => setTimeout(r, 5))
    expect(sent.filter((message) => message.kind === 'subscribe')).toHaveLength(1)

    push({ kind: 'event', channel: 'runtime:task-archived', payload: { taskId: 't1' } })
    await new Promise((r) => setTimeout(r, 5))
    expect(first).toHaveBeenCalledWith({ taskId: 't1' })
    expect(second).toHaveBeenCalledWith({ taskId: 't1' })

    off()
    push({ kind: 'event', channel: 'runtime:task-archived', payload: { taskId: 't2' } })
    await new Promise((r) => setTimeout(r, 5))
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(2)
  })

  it('reports a denied subscribe without throwing at the call site', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    host((message) =>
      message.kind === 'subscribe'
        ? { id: message.id, ok: false, error: { code: 'plugin_scope_denied', message: 'not declared', requestId: '', retryable: false } }
        : undefined,
    )
    const acorn = await handshake()
    // `on` is synchronous by design — a plugin registers listeners at startup and should not have to
    // await each one.
    expect(() => acorn.events.on('runtime:node-removed', vi.fn())).not.toThrow()
    await new Promise((r) => setTimeout(r, 5))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('runtime:node-removed'), expect.anything())
  })
})

describe('state and ui', () => {
  it('round-trips state through the host', async () => {
    host((message) => {
      if (message.kind === 'state.get') return { id: message.id, ok: true, status: 200, body: [1, 2] }
      if (message.kind === 'state.set') return { id: message.id, ok: true, status: 200, body: null }
      return undefined
    })
    const acorn = await handshake()
    await expect(acorn.state.get('columns')).resolves.toEqual([1, 2])
    await acorn.state.set('columns', [3])
    expect(sent.at(-1)).toMatchObject({ kind: 'state.set', key: 'columns', value: [3] })
  })

  it('sends each ui verb as its own op', async () => {
    host((message) => (message.kind === 'ui' ? { id: message.id, ok: true, status: 200, body: null } : undefined))
    const acorn = await handshake()
    await acorn.ui.toast('done', 'three cards')
    expect(sent.at(-1)).toMatchObject({ op: 'toast', title: 'done', detail: 'three cards' })
    await acorn.ui.copy('abc')
    expect(sent.at(-1)).toMatchObject({ op: 'copy', text: 'abc' })
    await acorn.ui.openPane('board')
    expect(sent.at(-1)).toMatchObject({ op: 'openPane', paneId: 'board' })
    await acorn.ui.done()
    expect(sent.at(-1)).toMatchObject({ op: 'importer.done' })
    await acorn.ui.close()
    expect(sent.at(-1)).toMatchObject({ op: 'importer.close' })
  })

  it('surfaces a denied ui verb as a rejection', async () => {
    host((message) =>
      message.kind === 'ui'
        ? { id: message.id, ok: false, error: { code: 'plugin_scope_denied', message: 'not an importer', requestId: '', retryable: false } }
        : undefined,
    )
    const acorn = await handshake()
    await expect(acorn.ui.done()).rejects.toBeInstanceOf(AcornBridgeError)
  })
})

describe('webview controls', () => {
  it('sends the closed verb set and receives intrinsic host events without subscribing', async () => {
    host((message) => (message.kind === 'webview' ? { id: message.id, ok: true, status: 200, body: null } : undefined))
    const acorn = await handshake({ ...CONTEXT, target: 'webview' as const })
    await acorn.webview.navigate('https://docs.example.com/start')
    await acorn.webview.back()
    await acorn.webview.forward()
    await acorn.webview.reload()
    expect(sent.filter((message) => message.kind === 'webview')).toEqual([
      expect.objectContaining({ op: 'navigate', url: 'https://docs.example.com/start' }),
      expect.objectContaining({ op: 'back' }),
      expect.objectContaining({ op: 'forward' }),
      expect.objectContaining({ op: 'reload' }),
    ])

    const navigated = vi.fn()
    acorn.webview.onNavigated(navigated)
    push({ kind: 'event', channel: 'webview:navigated', payload: { url: 'https://docs.example.com/start', loading: false } })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(navigated).toHaveBeenCalledWith(expect.objectContaining({ url: 'https://docs.example.com/start' }))
    expect(sent.some((message) => message.kind === 'subscribe' && message.channel === 'webview:navigated')).toBe(false)
  })
})

describe('appearance', () => {
  it('notifies listeners on every push', async () => {
    host(() => undefined)
    const acorn = await handshake()
    const seen: { theme: string; style: string }[] = []
    const off = acorn.onAppearance((appearance) => void seen.push(appearance))
    push({ kind: 'appearance', theme: 'dark', style: 'terminal', tokens: { '--bg': '#000' } })
    await new Promise((r) => setTimeout(r, 5))
    off()
    push({ kind: 'appearance', theme: 'light', style: 'modern', tokens: {} })
    await new Promise((r) => setTimeout(r, 5))
    expect(seen).toEqual([{ theme: 'dark', style: 'terminal' }])
  })
})
