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

describe('uiControlClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.resetModules()
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
    vi.stubGlobal('location', { origin: 'http://127.0.0.1:3030', pathname: '/' })
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('registers the window and maps a pane command to the layout reducer', async () => {
    const client = await import('./uiControlClient')
    const tasks = await import('../tasks/tasks')
    const dispose = client.activateUiControl()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    expect(socket.sent.map((v) => JSON.parse(v))).toContainEqual(expect.objectContaining({ channel: 'ui:register', windowId: 'primary', primary: true }))

    socket.message({ channel: 'ui:command', requestId: 'r1', windowId: 'primary', commandId: 'core.pane.show', input: { taskId: 't1', paneId: 'notes', mode: 'add' } })
    await Promise.resolve()
    await Promise.resolve()

    // the layout reducer added the pane
    expect(tasks.taskLayouts()['t1'].panes).toContain('notes')
    // and a success result crossed back
    const results = socket.sent.map((v) => JSON.parse(v)).filter((f) => f.channel === 'ui:command-result')
    expect(results).toContainEqual(expect.objectContaining({ requestId: 'r1', ok: true }))
    dispose()
  })

  it('reports command_unavailable for an unmapped command', async () => {
    const client = await import('./uiControlClient')
    client.activateUiControl()
    const socket = FakeWebSocket.instances[0]
    socket.open()
    socket.message({ channel: 'ui:command', requestId: 'r2', windowId: 'primary', commandId: 'core.settings.open', input: {} })
    await Promise.resolve()
    await Promise.resolve()
    const results = socket.sent.map((v) => JSON.parse(v)).filter((f) => f.channel === 'ui:command-result')
    expect(results).toContainEqual(expect.objectContaining({ requestId: 'r2', ok: false, error: expect.objectContaining({ code: 'command_unavailable' }) }))
  })
})
