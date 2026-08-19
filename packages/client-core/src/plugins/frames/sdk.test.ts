import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PluginFrameContext } from '@acorn/protocol/pluginBridge.ts'
import { AcornBridgeError, connect, mountFrame, openLinkOnClick, _resetConnection, type AcornBridge } from './sdk'

// The SDK runs inside a frame, so there is no window here to run it in: the suite is plain Node
// (packages/client-core/vitest.config.ts). What it needs is exactly what a frame gives it — something
// to hear one `message` event on, and a port. Both are stubbed; the port is a real MessageChannel.

type Hello = { data: unknown; ports: MessagePort[] }

let windowListeners: ((event: Hello) => void)[] = []
let keyListeners: ((event: KeyboardEvent) => void)[] = []
let channel: MessageChannel
// Everything the frame sent, in order.
let sent: Record<string, unknown>[] = []

const HELLO = { acornBridge: 1 }
const CONTEXT: PluginFrameContext = {
  surface: 'board', target: 'pane', nodeId: 'node-a', theme: 'dark', style: 'terminal', claimsKeys: ['meta+f'],
}

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
  keyListeners = []
  sent = []
  channel = new MessageChannel()
  vi.stubGlobal('addEventListener', (type: string, listener: ((event: Hello) => void) | ((event: KeyboardEvent) => void)) => {
    if (type === 'message') windowListeners.push(listener as (event: Hello) => void)
    if (type === 'keydown') keyListeners.push(listener as (event: KeyboardEvent) => void)
  })
  vi.stubGlobal('removeEventListener', (type: string, listener: ((event: Hello) => void) | ((event: KeyboardEvent) => void)) => {
    if (type === 'message') windowListeners = windowListeners.filter((entry) => entry !== listener)
    if (type === 'keydown') keyListeners = keyListeners.filter((entry) => entry !== listener)
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

  it('acks the handshake, which is the host\'s only evidence the bundle evaluated', async () => {
    // A bundle that throws at module scope never calls connect(), so this message never arrives and the
    // host draws a placeholder instead of a blank rectangle.
    host(() => undefined)
    await handshake()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(sent).toEqual([{ kind: 'connected' }])
  })
})

describe('frame key forwarding', () => {
  const press = (over: Partial<KeyboardEvent> = {}) => {
    const preventDefault = vi.fn()
    const event = {
      code: 'KeyK', key: 'k', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false,
      target: { nodeName: 'DIV' }, preventDefault, ...over,
    } as unknown as KeyboardEvent
    for (const listener of keyListeners) listener(event)
    return preventDefault
  }

  it('forwards canonical chords without swallowing unbindable or bare-key defaults', async () => {
    host(() => undefined)
    const acorn = await handshake()

    const space = press({ code: 'Space', key: ' ', metaKey: false })
    const tab = press({ code: 'Tab', key: 'Tab', metaKey: false })
    const arrow = press({ code: 'ArrowDown', key: 'ArrowDown', metaKey: false })
    const bare = press({ code: 'KeyJ', key: 'j', metaKey: false })
    const modified = press()
    const claimed = press({ code: 'KeyF', key: 'f' })
    await new Promise((resolve) => setTimeout(resolve, 5))

    expect(space).not.toHaveBeenCalled()
    expect(tab).not.toHaveBeenCalled()
    expect(arrow).not.toHaveBeenCalled()
    expect(bare).not.toHaveBeenCalled()
    expect(modified).toHaveBeenCalled()
    expect(claimed).not.toHaveBeenCalled()
    expect(sent).not.toContainEqual({ kind: 'keydown', chord: ' ' })
    expect(sent).not.toContainEqual({ kind: 'keydown', chord: 'tab' })
    expect(sent).not.toContainEqual({ kind: 'keydown', chord: 'arrowdown' })
    expect(sent).toContainEqual({ kind: 'keydown', chord: 'j' })
    expect(sent).toContainEqual({ kind: 'keydown', chord: 'meta+k' })
    expect(sent).not.toContainEqual({ kind: 'keydown', chord: 'meta+f' })

    acorn.keys.claim([])
    press({ code: 'KeyF', key: 'f' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(sent).toContainEqual({ kind: 'keydown', chord: 'meta+f' })
  })

  it('ignores undeclared runtime claims and leaves bare typing keys inside inputs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    host(() => undefined)
    const acorn = await handshake()
    acorn.keys.claim(['meta+j'])
    press({ code: 'KeyJ', key: 'j' })
    press({ code: 'KeyA', key: 'a', metaKey: false, target: { nodeName: 'INPUT' } } as unknown as Partial<KeyboardEvent>)
    await new Promise((resolve) => setTimeout(resolve, 5))
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('meta+j'))
    expect(sent).toContainEqual({ kind: 'keydown', chord: 'meta+j' })
    expect(sent).not.toContainEqual({ kind: 'keydown', chord: 'a' })
  })

  it('leaves the clipboard to the browser, so a selection inside a frame can be copied', async () => {
    host(() => undefined)
    await handshake()
    const copy = press({ code: 'KeyC', key: 'c' })
    const paste = press({ code: 'KeyV', key: 'v' })
    const selectAll = press({ code: 'KeyA', key: 'a' })
    await new Promise((resolve) => setTimeout(resolve, 5))

    // Cancelling these is what made Cmd+C in a plugin's table do nothing at all.
    expect(copy).not.toHaveBeenCalled()
    expect(paste).not.toHaveBeenCalled()
    expect(selectAll).not.toHaveBeenCalled()
    expect(sent).not.toContainEqual({ kind: 'keydown', chord: 'meta+c' })
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

describe('the shared document and surface actions', () => {
  it('round-trips the document the host is drawing beside this frame', async () => {
    host((message) => {
      if (message.kind !== 'document') return undefined
      if (message.op === 'read') return { id: message.id, ok: true, status: 200, body: { text: 'SELECT 1;' } }
      return { id: message.id, ok: true, status: 200, body: null }
    })
    const acorn = await handshake()
    expect(await acorn.document.read()).toBe('SELECT 1;')
    await acorn.document.write('SELECT 2;')
    await acorn.document.flush()
    expect(sent.filter((message) => message.kind === 'document').map((message) => message.op)).toEqual(['read', 'write', 'flush'])
    expect(sent.find((message) => message.op === 'write')?.text).toBe('SELECT 2;')
  })

  // The chord landed in the host's editor, where this frame has no keyboard at all. What arrives is the
  // command id and nothing else — the frame is not told which gesture produced it, deliberately, so it
  // handles a chord and a palette row through one path.
  it('fans a surface action out to its listeners and stops on unsubscribe', async () => {
    host(() => undefined)
    const acorn = await handshake()
    const ran = vi.fn()
    const off = acorn.onSurfaceAction(ran)
    push({ kind: 'surfaceAction', command: 'execute' })
    await new Promise((r) => setTimeout(r, 5))
    expect(ran).toHaveBeenCalledWith('execute')

    off()
    push({ kind: 'surfaceAction', command: 'execute' })
    await new Promise((r) => setTimeout(r, 5))
    expect(ran).toHaveBeenCalledTimes(1)
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
    await acorn.ui.openUrl('https://github.com/runn/acorn/pull/1')
    expect(sent.at(-1)).toMatchObject({ op: 'openUrl', url: 'https://github.com/runn/acorn/pull/1' })
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

describe('openLinkOnClick', () => {
  // A stand-in for the one thing the helper touches: `event.target.closest('a')`. There is no DOM here
  // (client-core's suite is plain Node) and the helper needs none — it reads an href and calls a verb.
  const clickOn = (href: string | null, over: Partial<MouseEvent> = {}): MouseEvent & { prevented: boolean } => {
    const event = {
      defaultPrevented: false,
      button: 0,
      prevented: false,
      target: { closest: (selector: string) => (selector === 'a' && href !== null ? { getAttribute: () => href } : null) },
      preventDefault() {
        this.prevented = true
      },
      ...over,
    }
    return event as unknown as MouseEvent & { prevented: boolean }
  }

  // The helper is fire-and-forget by design — a click handler cannot await — so the port hop has to be
  // let through before `sent` can be read.
  //
  // A poll and not a single `setTimeout(0)`, which is what this was. A MessagePort is its own task source,
  // so a zero-delay timer is not a barrier for it: under real load — the whole workspace's suites running
  // at once — the timer fired first and the assertion read an empty `sent`. It passed in isolation every
  // time, which is the worst version of this bug.
  const delivered = async (op: string): Promise<Record<string, unknown> | undefined> => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const message = sent.find((entry) => entry.op === op)
      if (message) return message
      await new Promise((resolve) => setTimeout(resolve, 1))
    }
    return undefined
  }
  // For the negative cases, which have no message to wait for. Bounded ticks rather than one, for the same
  // reason: "nothing arrived" is only meaningful once something had the chance to.
  const flushed = async () => {
    for (let attempt = 0; attempt < 10; attempt++) await new Promise((resolve) => setTimeout(resolve, 1))
  }

  const connected = async (): Promise<AcornBridge> => {
    host((message) => (message.kind === 'ui' ? { id: message.id, ok: true, status: 200, body: null } : undefined))
    return handshake()
  }

  it('takes an https anchor and hands the href to the host', async () => {
    const acorn = await connected()
    const event = clickOn('https://github.com/runn/acorn/pull/20535')
    expect(openLinkOnClick(acorn, event)).toBe(true)
    expect(event.prevented).toBe(true)
    // The message this click sent, found by name rather than taken as the last one to arrive: the SDK's
    // handshake ack rides the same port unasked, so `sent.at(-1)` is a race even when nothing is slow.
    expect(await delivered('openUrl')).toMatchObject({ kind: 'ui', op: 'openUrl', url: 'https://github.com/runn/acorn/pull/20535' })
  })

  it('takes a MODIFIED click too, unlike the shell handler it mirrors', async () => {
    // In the shell a cmd-click is the reader asking for a browser tab, so the anchor keeps its default.
    // Inside a frame there is no default to keep — the sandbox has no `allow-popups` — so bailing here
    // would make cmd-click the one gesture that does nothing at all.
    const acorn = await connected()
    const event = clickOn('https://example.com/', { metaKey: true, shiftKey: true })
    expect(openLinkOnClick(acorn, event)).toBe(true)
    expect(await delivered('openUrl')).toMatchObject({ op: 'openUrl' })
  })

  it('leaves a non-https href alone, with its default intact', async () => {
    const acorn = await connected()
    const before = sent.length
    // `mailto:` is the honest casualty: renderMarkdown allows it, the verb does not, and preventing the
    // default would only replace an inert link with a denied bridge call.
    for (const href of ['mailto:someone@example.com', 'http://internal.example/', 'javascript:alert(1)', '#anchor', null]) {
      const event = clickOn(href)
      expect(openLinkOnClick(acorn, event), String(href)).toBe(false)
      expect(event.prevented, String(href)).toBe(false)
    }
    await flushed()
    // Filtered, because the handshake ack is the one message that arrives unasked — the SDK posts it on
    // `ready` and the port delivers it a tick later, which is after `before` was read.
    expect(sent.filter((message) => message.kind !== 'connected').length).toBe(before)
  })

  it('ignores a click something else has already handled', async () => {
    const acorn = await connected()
    expect(openLinkOnClick(acorn, clickOn('https://example.com/', { defaultPrevented: true }))).toBe(false)
    expect(openLinkOnClick(acorn, clickOn('https://example.com/', { button: 1 }))).toBe(false)
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

describe('mountFrame', () => {
  // The smallest document the boot sequence touches. There is no DOM in this suite and the helper needs
  // no real one: it creates two elements, appends them, and (through mountFrameTips) listens on the
  // document. Anything it reaches for that is not here shows up as a TypeError rather than as silence.
  type FakeElement = {
    tag: string
    id?: string
    className?: string
    hidden?: boolean
    textContent?: string
    dataset: Record<string, string>
    style: Record<string, string>
    children: FakeElement[]
    append(...nodes: FakeElement[]): void
    replaceChildren(): void
    remove(): void
  }
  const element = (tag: string): FakeElement => ({
    tag,
    dataset: {},
    style: {},
    children: [],
    append(...nodes) { this.children.push(...nodes) },
    replaceChildren() { this.children = [] },
    remove() {},
  })

  let head: FakeElement
  let body: FakeElement

  beforeEach(() => {
    head = element('head')
    body = element('body')
    vi.stubGlobal('document', {
      head,
      body,
      createElement: element,
      addEventListener: () => {},
      removeEventListener: () => {},
    })
  })

  const root = () => body.children.find((child) => child.id === 'root')!

  it('injects the stylesheet, makes the root, and renders once the bridge is up', async () => {
    host(() => undefined)
    const rendered: { bridge: AcornBridge; root: unknown }[] = []
    mountFrame({ styles: '.rb-row { color: red }' }, (bridge, node) => void rendered.push({ bridge, root: node }))
    // The stylesheet is injected before the handshake — a frame that never connects still has its CSS,
    // which is what makes the failure banner below legible.
    expect(head.children.map((child) => child.textContent)).toEqual(['.rb-row { color: red }'])
    expect(root()).toBeTruthy()
    const acorn = await handshake()
    await new Promise((r) => setTimeout(r, 0))
    expect(rendered).toEqual([{ bridge: acorn, root: root() }])
  })

  it('paints the alert primitive on the root when the bridge never arrives', async () => {
    // No window to hear the handshake on, which is what `connect` refuses. There is no framework at this
    // point — that is the thing that failed — so the Alert primitive's classes go on the root by hand,
    // and the reader gets a sentence instead of a blank rectangle.
    vi.stubGlobal('addEventListener', undefined)
    let rendered = false
    mountFrame({ styles: '' }, () => void (rendered = true))
    await new Promise((r) => setTimeout(r, 0))
    expect(rendered).toBe(false)
    expect(root().className).toBe('ui-alert')
    expect(root().dataset).toEqual({ variant: 'banner', tone: 'danger' })
    expect(root().textContent).toBe('acorn: no window to receive the bridge on')
  })
})
