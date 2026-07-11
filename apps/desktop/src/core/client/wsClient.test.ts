import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

class FakeWebSocket {
  static readonly CONNECTING = 0
  static readonly OPEN = 1
  static instances: FakeWebSocket[] = []
  readyState = FakeWebSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this)
  }
  send(value: string) { this.sent.push(value) }
  open() { this.readyState = FakeWebSocket.OPEN; this.onopen?.() }
  close() { this.readyState = 3; this.onclose?.() }
  message(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }) }
}

describe('wsClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:3030' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('reconnects, re-attaches live subscriptions, and dispatches replay output', async () => {
    const client = await import('./wsClient')
    const output: unknown[] = []
    const off = client.wsAttach('s1', (message) => output.push(message))
    const first = FakeWebSocket.instances[0]
    expect(first.url).toBe('ws://127.0.0.1:3030/ws')
    first.open()
    expect(first.sent.map((value) => JSON.parse(value))).toContainEqual({ channel: 'term:attach', id: 's1' })
    first.message({ channel: 'term:out', id: 's1', msg: { type: 'output', data: 'ring' } })
    expect(output).toEqual([{ type: 'output', data: 'ring' }])

    first.close()
    await vi.advanceTimersByTimeAsync(1000)
    const second = FakeWebSocket.instances[1]
    second.open()
    expect(second.sent.map((value) => JSON.parse(value))).toContainEqual({ channel: 'term:attach', id: 's1' })
    off()
  })

  it('queues writes while connecting and fans status/notice frames to subscribers', async () => {
    const client = await import('./wsClient')
    const statuses: number[] = []
    const notices: string[] = []
    client.wsOnStatus(() => statuses.push(1))
    client.wsOnNotice((notice) => notices.push(notice.kind))
    client.wsWrite('s1', 'echo ok\n')
    const socket = FakeWebSocket.instances[0]
    socket.open()
    expect(socket.sent.map((value) => JSON.parse(value))).toContainEqual({ channel: 'term:input', id: 's1', data: 'echo ok\n' })
    socket.message({ channel: 'term:status' })
    socket.message({ channel: 'workflow:notice', notice: { taskId: 't1', kind: 'repo-config-trust', title: 'review', action: 'review-config' } })
    expect(statuses).toEqual([1])
    expect(notices).toEqual(['repo-config-trust'])
  })

  it('registers the UI control window and answers ui:command frames', async () => {
    const client = await import('./wsClient')
    const calls: { commandId: string; input: unknown }[] = []
    client.wsRegisterUi('win-1', true, { revision: 0 }, async (commandId, input) => {
      calls.push({ commandId, input })
      return { ok: true, result: { changed: true }, revision: 1 }
    })
    const socket = FakeWebSocket.instances[0]
    socket.open()
    // ui:register is sent on open
    expect(socket.sent.map((v) => JSON.parse(v))).toContainEqual({ channel: 'ui:register', windowId: 'win-1', primary: true, snapshot: { revision: 0 } })

    socket.message({ channel: 'ui:command', requestId: 'r1', windowId: 'win-1', commandId: 'core.pane.show', input: { paneId: 'pr' } })
    await Promise.resolve()
    expect(calls).toEqual([{ commandId: 'core.pane.show', input: { paneId: 'pr' } }])
    expect(socket.sent.map((v) => JSON.parse(v))).toContainEqual({ channel: 'ui:command-result', requestId: 'r1', ok: true, result: { changed: true }, revision: 1 })

    client.wsSendUiState('win-1', { revision: 2 })
    expect(socket.sent.map((v) => JSON.parse(v))).toContainEqual({ channel: 'ui:state', windowId: 'win-1', snapshot: { revision: 2 } })
  })
})
