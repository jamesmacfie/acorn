import { createSignal, Show } from 'solid-js'
import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { ServerMsg, TerminalSession } from '@acorn/plugin-terminal/contract/wire.ts'
import { prefsKey } from '@acorn/protocol/api.ts'
import { PrefKeys, savePref, type Task } from '@acorn/plugin-api/client'
import {
  extensionPointRegistry,
  extensionRegistry,
  type Disposable,
  type ExtensionContribution,
} from '@acorn/plugin-api/testkit/client'
import { TERMINAL_TOOLBAR_ACTIONS_POINT, type TerminalToolbarProps } from '../contract/toolbarActions'

// What a terminal tab switch costs, in jsdom. A switch must not destroy an xterm and its WebGL context
// or ask the node to serialize a thousand-line framebuffer, and nothing short of a person clicking tabs
// would notice that regression.
//
// The real `TerminalSurface` runs here. What is stubbed is xterm, because it draws to a canvas and
// jsdom has no layout to draw into; everything this file is about — when a surface is built, when it
// attaches, and whether its element survives — is the shipped code.

class StubTerminal {
  static built: StubTerminal[] = []
  cols = 80
  rows = 24
  options: Record<string, unknown>
  disposed = false
  element: HTMLElement | undefined
  written: string[] = []

  constructor(options: Record<string, unknown>) {
    StubTerminal.built.push(this)
    this.options = options
  }

  loadAddon(): void {}
  // Like xterm, one element for life, put into the first parent it is given.
  open(parent: HTMLElement): void {
    this.element = document.createElement('div')
    this.element.className = 'xterm'
    parent.append(this.element)
  }
  write(data: string): void {
    this.written.push(data)
  }
  focus(): void {}
  blur(): void {}
  attachCustomKeyEventHandler(): void {}
  onData(): void {}
  onResize(): void {}
  dispose(): void {
    this.disposed = true
    this.element?.remove()
  }
}

class StubWebgl {
  static made: StubWebgl[] = []
  disposed = false
  lose: (() => void) | undefined
  constructor() {
    StubWebgl.made.push(this)
  }
  onContextLoss(listener: () => void): void {
    this.lose = listener
  }
  dispose(): void {
    this.disposed = true
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: StubTerminal }))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  },
}))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: StubWebgl }))
// These tests exercise terminal rendering and session lifetime with a running terminal service.
// The shared host gate withholds an unknown roster, so supply that premise explicitly.
vi.mock('@acorn/plugin-api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@acorn/plugin-api/client')>()),
  hasHostCapability: () => true,
}))
// Shiki sits behind the real one, and an ANSI palette is not what this file is about.
vi.mock('./theme', () => ({ baseTheme: () => ({}), monoFont: () => 'monospace', xtermTheme: async () => ({}) }))

const attaches: string[] = []
let offline = false
let loadProfiles: (() => Promise<unknown[]>) | undefined
let loadRoster: (() => Promise<TerminalSession[]>) | undefined
let createSession: (() => Promise<TerminalSession>) | undefined
const created: string[] = []
const createdTitles: string[] = []
const detaches: string[] = []
const attachSizes: ({ cols: number; rows: number } | undefined)[] = []
const listeners = new Map<string, (m: ServerMsg) => void>()
const resizes: string[] = []
const interrupts: string[] = []
vi.mock('./terminalClient', () => ({
  terminalApi: () => ({
    list: async () => {
      if (loadRoster) return loadRoster()
      if (offline) throw new Error('node unreachable')
      return roster
    },
    profiles: async () => (loadProfiles ? loadProfiles() : []),
    create: async (body: { title: string }) => {
      created.push('create')
      createdTitles.push(body.title)
      return createSession ? createSession() : session(A, 'new')
    },
    resize: async (id: string, cols: number, rows: number) => {
      resizes.push(`${id} ${cols}x${rows}`)
      return true
    },
    write: () => {},
    interrupt: async (id: string) => {
      interrupts.push(id)
      return true
    },
    remove: async () => true,
    attach: (id: string, on: (m: ServerMsg) => void, size?: { cols: number; rows: number }) => {
      attaches.push(id)
      attachSizes.push(size)
      listeners.set(id, on)
      return () => detaches.push(id)
    },
  }),
}))

// jsdom does no layout, so the kit's tab strip cannot scroll its active tab into view.
Element.prototype.scrollIntoView ??= () => {}

// jsdom has no ResizeObserver, and the surface observes its own box.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver

const { default: TerminalPanel } = await import('./TerminalPanel')
const { refreshSessions } = await import('./sessionStore')
const { heldTerminalCount } = await import('./heldTerminals')
const { HIDDEN_DETACH_MS, WEBGL_TERMINALS, webglTerminalCount } = await import('./liveXterm')

const A = '11111111-2222-3333-4444-555555555555'
const B = '99999999-8888-7777-6666-555555555555'

const session = (id: string, title: string, taskId = 't1'): TerminalSession =>
  ({
    id,
    title,
    kind: 'shell',
    profileId: 'shell',
    backend: 'node-pty',
    status: 'running',
    idle: false,
    agentState: 'unknown',
    isWorktree: true,
    taskId,
    cwd: '/w',
    command: 'bash',
    cols: 80,
    rows: 24,
    createdAt: 1,
    exitCode: null,
  }) satisfies TerminalSession

const task = { id: 't1', title: 'a task' } as unknown as Task

// The session roster the node would answer with. There is no host object installed, so client-core's
// api client falls through to same-origin `fetch`, which is the seam it documents for a unit test.
let roster: TerminalSession[] = []

const cleanups: (() => void)[] = []

beforeEach(() => {
  loadProfiles = undefined
  loadRoster = undefined
  createSession = undefined
  created.length = 0
  createdTitles.length = 0
  offline = false
  roster = [session(A, 'first'), session(B, 'second')]
  vi.stubGlobal(
    'fetch',
    async (url: string) =>
      new Response(JSON.stringify(String(url).endsWith('/sessions') ? roster : {}), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
  )
})

afterEach(async () => {
  for (const dispose of cleanups.splice(0)) dispose()
  document.body.replaceChildren()
  // An empty roster is what lets the held xterms go, so it runs before the records are cleared.
  roster = []
  await refreshSessions()
  attaches.length = 0
  detaches.length = 0
  attachSizes.length = 0
  listeners.clear()
  resizes.length = 0
  StubTerminal.built = []
  StubWebgl.made = []
  vi.unstubAllGlobals()
})

// Solid's effects, the roster read and the surface's own requestAnimationFrame all settle on later
// turns.
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => requestAnimationFrame(resolve))
}

// The `Drawer` host component draws the dock itself, into the document rather than into whatever
// element rendered the plugin's panel, so both readers below look at the document.
//
// `open` is the drawer's per-task open state, which the host's slot follows: false unmounts the whole
// panel, the way a switch to a task without the drawer open does.
const mount = (drawer: { task?: () => Task; open?: () => boolean; defaultProfile?: string } = {}): void => {
  const host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // savePref only patches a cache that already holds the Node's answer.
  client.setQueryData(prefsKey, {})
  void savePref(client, PrefKeys.terminalRailDefault, drawer.defaultProfile ?? '')
  cleanups.push(
    render(
      () => (
        <QueryClientProvider client={client}>
          <Show when={drawer.open?.() ?? true}>
            <TerminalPanel task={drawer.task?.() ?? task} onClose={() => {}} />
          </Show>
        </QueryClientProvider>
      ),
      host,
    ),
  )
}

const surfaces = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.ui-rect[data-kind="pty"]')]
const tab = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`#terminal-tab-${id}`)

describe('the terminal drawer keeps every open session on screen', () => {
  it('switches tabs with no attach and no new xterm, keeping the inactive surface', async () => {
    mount()
    await settle()

    // Two boxes, one shown. The second session's surface exists but has built no xterm: a tab nobody
    // has looked at costs nothing, and xterm cannot measure a box that is display:none anyway.
    expect(surfaces()).toHaveLength(2)
    expect(surfaces().map((box) => box.hidden)).toEqual([false, true])
    expect(attaches).toEqual([A])
    expect(StubTerminal.built).toHaveLength(1)

    const [firstBox, secondBox] = surfaces()
    tab(B)?.click()
    await settle()

    // The switch shows the other box. Nothing was unmounted, nothing detached, and the only new work
    // is the second tab's own first xterm.
    expect(surfaces()[0]).toBe(firstBox)
    expect(surfaces()[1]).toBe(secondBox)
    expect(surfaces().map((box) => box.hidden)).toEqual([true, false])
    expect(attaches).toEqual([A, B])
    expect(detaches).toEqual([])

    // …and switching back is a repaint: no attach, no xterm, the same two elements.
    tab(A)?.click()
    await settle()
    expect(attaches).toEqual([A, B])
    expect(StubTerminal.built).toHaveLength(2)
    expect(surfaces()[0]).toBe(firstBox)
    expect(surfaces().map((box) => box.hidden)).toEqual([false, true])
  })

  it('keeps every element across a roster refresh that replaces the rows', async () => {
    mount()
    await settle()
    const before = surfaces()

    // Every refresh replaces the roster wholesale with new objects, which is why the surfaces are
    // keyed on the ids rather than on the rows: `<For>` over the rows would rebuild both and take
    // their xterms with them.
    roster = [session(A, 'first renamed'), session(B, 'second renamed')]
    await refreshSessions()
    await settle()

    expect(surfaces()).toEqual(before)
    expect(attaches).toEqual([A])
    expect(detaches).toEqual([])
  })

  it('drops the closed session and leaves the survivor on its own element', async () => {
    mount()
    await settle()
    tab(B)?.click()
    await settle()
    const secondBox = surfaces()[1]
    expect(attaches).toEqual([A, B])

    // The first session goes. This is where `<Index>` would be wrong: keyed by position, row 0 would
    // keep its element and be handed the second session, so the surviving xterm would be the closed
    // tab's.
    roster = [session(B, 'second')]
    await refreshSessions()
    await settle()

    expect(surfaces()).toEqual([secondBox])
    expect(surfaces()[0].hidden).toBe(false)
    expect(attaches).toEqual([A, B])
    expect(detaches).toEqual([A])
  })
})

describe('a surface attaches in one request', () => {
  // One session, so the tab an earlier test left active for this task cannot be the one shown.
  beforeEach(() => {
    roster = [session(A, 'first')]
  })

  it('sends its size with the attach and posts no resize when the node took it', async () => {
    mount()
    await settle()

    // The stub xterm fits to 80x24. The size rides on the attach rather than on a resize the attach
    // waits for.
    expect(attaches).toEqual([A])
    expect(attachSizes).toEqual([{ cols: 80, rows: 24 }])
    expect(resizes).toEqual([])

    listeners.get(A)?.({ type: 'ready', session: session(A, 'first'), replayed: true })
    await settle()
    expect(resizes).toEqual([])
  })

  it('still resizes against a node that ignored the size', async () => {
    mount()
    await settle()

    // An older node attaches at the size it last had and says so in `ready`.
    listeners.get(A)?.({ type: 'ready', session: { ...session(A, 'first'), cols: 120, rows: 40 }, replayed: true })
    await settle()
    expect(resizes).toEqual([`${A} 80x24`])
  })
})

// The drawer's open state is per task, so going to a task without it open unmounts the whole panel.
// The xterms are held outside it (./heldTerminals.ts), until the session leaves the roster.
describe('a terminal outlives the drawer that drew it', () => {
  beforeEach(() => {
    roster = [session(A, 'first')]
  })

  it('reuses the same attached xterm when the drawer comes back', async () => {
    const [open, setOpen] = createSignal(true)
    mount({ open })
    await settle()
    expect(StubTerminal.built).toHaveLength(1)
    const [xterm] = StubTerminal.built

    setOpen(false)
    await settle()
    // Nothing drawn, nothing let go: still attached, and its element is out of the document rather
    // than left inside a box that has gone.
    expect(surfaces()).toHaveLength(0)
    expect(detaches).toEqual([])
    expect(xterm.disposed).toBe(false)
    expect(xterm.element?.isConnected).toBe(false)

    setOpen(true)
    await settle()
    expect(StubTerminal.built).toEqual([xterm])
    expect(attaches).toEqual([A])
    expect(surfaces()[0].contains(xterm.element!)).toBe(true)
  })

  it('lets go of a terminal nobody has drawn for ten seconds, and attaches again when it is shown', async () => {
    vi.useFakeTimers()
    try {
      const [open, setOpen] = createSignal(true)
      mount({ open })
      await vi.advanceTimersByTimeAsync(100)
      const [xterm] = StubTerminal.built

      setOpen(false)
      await vi.advanceTimersByTimeAsync(HIDDEN_DETACH_MS - 1)
      expect(detaches).toEqual([])
      await vi.advanceTimersByTimeAsync(1)
      expect(detaches).toEqual([A])

      setOpen(true)
      await vi.advanceTimersByTimeAsync(100)
      expect(StubTerminal.built).toEqual([xterm])
      expect(attaches).toEqual([A, A])
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays attached when the drawer comes back inside the ten seconds', async () => {
    vi.useFakeTimers()
    try {
      const [open, setOpen] = createSignal(true)
      mount({ open })
      await vi.advanceTimersByTimeAsync(100)
      setOpen(false)
      await vi.advanceTimersByTimeAsync(HIDDEN_DETACH_MS - 1_000)
      setOpen(true)
      await vi.advanceTimersByTimeAsync(HIDDEN_DETACH_MS * 2)
      expect(detaches).toEqual([])
      expect(attaches).toEqual([A])
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps writing output that arrives while nobody draws it', async () => {
    const [open, setOpen] = createSignal(true)
    mount({ open })
    await settle()
    setOpen(false)
    await settle()

    listeners.get(A)?.({ type: 'output', data: 'built in the background\r\n' })
    expect(StubTerminal.built[0].written).toEqual(['built in the background\r\n'])
  })

  it('disposes the xterm and its attachment when the tab closes', async () => {
    mount()
    await settle()
    const [xterm] = StubTerminal.built
    expect(heldTerminalCount()).toBe(1)

    // The node forgets the session once `remove` answers, and the drawer re-reads the roster.
    roster = []
    document.querySelector<HTMLElement>('[aria-label="Close first"]')?.click()
    await settle()

    expect(xterm.disposed).toBe(true)
    expect(detaches).toEqual([A])
    expect(heldTerminalCount()).toBe(0)
  })

  it('disposes a held xterm whose session goes while its drawer is closed', async () => {
    const [open, setOpen] = createSignal(true)
    mount({ open })
    await settle()
    setOpen(false)
    await settle()

    // Killed from the palette, or its task archived: the roster read is what says so.
    roster = []
    await refreshSessions()
    expect(StubTerminal.built[0].disposed).toBe(true)
    expect(detaches).toEqual([A])
  })

  it('keeps every held xterm through a roster read that fails', async () => {
    const [open, setOpen] = createSignal(true)
    mount({ open })
    await settle()
    setOpen(false)
    await settle()

    // A failed read retains both the roster and every warm terminal.
    offline = true
    await refreshSessions().catch(() => {})
    offline = false
    expect(StubTerminal.built[0].disposed).toBe(false)
    expect(detaches).toEqual([])
  })
})

describe('the WebGL contexts stay bounded', () => {
  const ids = Array.from({ length: WEBGL_TERMINALS + 3 }, (_, index) => `${index}0000000-0000-4000-8000-000000000000`)
  beforeEach(() => {
    roster = ids.map((id, index) => session(id, `tab ${index}`, `task-${index}`))
  })

  it('keeps a renderer on the terminals shown most recently and none past the bound', async () => {
    // One task per session, visited in turn with the drawer open on each: every terminal stays alive.
    const [current, setCurrent] = createSignal(0)
    mount({ task: () => ({ id: `task-${current()}`, title: 'task' }) as unknown as Task })
    await settle()
    for (let index = 1; index < ids.length; index += 1) {
      setCurrent(index)
      await settle()
    }

    expect(heldTerminalCount()).toBe(ids.length)
    expect(webglTerminalCount()).toBe(WEBGL_TERMINALS)
    expect(StubWebgl.made.filter((addon) => addon.disposed)).toHaveLength(ids.length - WEBGL_TERMINALS)

    // Back to the first: it takes a context again, and the oldest of the rest gives one up.
    setCurrent(0)
    await settle()
    expect(webglTerminalCount()).toBe(WEBGL_TERMINALS)
    expect(StubWebgl.made).toHaveLength(ids.length + 1)
  })

  it('falls back when a context is lost and asks again on the next show', async () => {
    const [current, setCurrent] = createSignal(0)
    mount({ task: () => ({ id: `task-${current()}`, title: 'task' }) as unknown as Task })
    await settle()
    const [first] = StubWebgl.made

    first.lose?.()
    expect(first.disposed).toBe(true)
    expect(webglTerminalCount()).toBe(0)

    setCurrent(1)
    await settle()
    setCurrent(0)
    await settle()
    expect(StubWebgl.made).toHaveLength(3)
    expect(webglTerminalCount()).toBe(2)
  })
})

describe('deferred panel work stays with its view', () => {
  it('settles a failed initial roster without auto-creating and permits a later valid mount', async () => {
    roster = []
    loadRoster = async () => {
      throw Error('roster offline')
    }
    mount({ defaultProfile: 'shell' })
    await settle()
    expect(document.body.textContent).toContain('roster offline')
    expect(document.body.textContent).not.toContain('Starting…')
    expect(created).toEqual([])
    for (const stop of cleanups.splice(0)) stop()
    loadRoster = undefined
    mount({ defaultProfile: 'shell' })
    await settle()
    expect(created).toEqual(['create'])
  })

  it('ignores a held profile rejection after disposal', async () => {
    let reject!: (reason: Error) => void
    loadProfiles = () =>
      new Promise((_resolve, no) => {
        reject = no
      })
    const [open, setOpen] = createSignal(true)
    mount({ open, defaultProfile: 'shell' })
    await settle()
    setOpen(false)
    reject(Error('late profile failure'))
    await settle()
    expect(document.body.textContent).not.toContain('late profile failure')
    expect(created).toEqual([])
  })
})

it('does not publish a held creation into a newer task after the task changes', async () => {
  roster = [session(B, 'incoming', 't2')]
  let finish!: (value: TerminalSession) => void
  createSession = () =>
    new Promise((resolve) => {
      finish = resolve
    })
  const [current, setCurrent] = createSignal(task)
  mount({ task: current, defaultProfile: 'shell' })
  await settle()
  expect(created).toEqual(['create'])
  setCurrent({ id: 't2', title: 'second task' } as Task)
  await settle()
  const incomingBox = surfaces()[0]
  finish(session(A, 'outgoing creation'))
  await settle()
  expect(tab(A)).toBeNull()
  expect(tab(B)?.getAttribute('aria-selected')).toBe('true')
  expect(surfaces()[0]).toBe(incomingBox)
})

it('numbers a new shell after the shells the task already has', async () => {
  roster = [session(A, 'Shell'), session(B, 'Shell 2')]
  loadProfiles = async () => [{ id: 'shell', label: 'Shell', available: true }]
  mount()
  await settle()
  ;(document.querySelector('button[aria-label="New terminal"]') as HTMLButtonElement).click()
  await settle()
  ;(
    [...document.querySelectorAll('[role="menuitem"]')].find((item) => item.textContent === 'Shell') as HTMLElement
  ).click()
  await settle()
  expect(createdTitles).toEqual(['Shell 3'])
})

describe('the terminal:toolbar-actions point', () => {
  // Compiled contributors, so no worker is involved: the worker path and its checks are client-core's
  // (Slot.test.tsx, RemoteTree.grants.test.tsx). What this drawer owns is where they draw, what they
  // are told, and when it agrees to interrupt.
  type Host = { invoke(name: string, payload?: unknown): Promise<unknown> }
  type Drawn = { pluginId: string; props: TerminalToolbarProps & { host: Host } }
  const drawn: Drawn[] = []
  const registered: Disposable[] = []
  let listen: ReturnType<typeof vi.spyOn>

  const contributor = (pluginId: string) => {
    const registration = extensionRegistry.register({
      id: `plugin:${pluginId}:interrupt`,
      pluginId,
      point: TERMINAL_TOOLBAR_ACTIONS_POINT,
      label: pluginId,
      order: 500,
      carrier: 'component',
      component: (props: Drawn['props']) => {
        drawn.push({ pluginId, props })
        return (
          <button type="button" data-contributor={pluginId}>
            {pluginId}
          </button>
        )
      },
    } as ExtensionContribution)
    registered.push(registration)
    return registration
  }

  /** A person's press inside one contributor. jsdom dispatches only untrusted events, so this calls the
   *  capturing listener the slot registered on that contributor's element with the browser's bit. */
  const press = (pluginId: string): void => {
    const button = document.querySelector(`[data-contributor="${pluginId}"]`)!
    const index = listen.mock.calls.findIndex(
      ([type]: unknown[], call: number) =>
        type === 'pointerdown' &&
        (listen.mock.contexts[call] as Element).tagName === 'SPAN' &&
        (listen.mock.contexts[call] as Element).contains(button),
    )
    ;(listen.mock.calls[index]![1] as EventListener)({ isTrusted: true } as Event)
  }
  const latest = (pluginId: string): Drawn['props'] =>
    drawn.filter((entry) => entry.pluginId === pluginId).at(-1)!.props

  beforeEach(() => {
    interrupts.length = 0
    drawn.length = 0
    registered.push(
      extensionPointRegistry.register({
        id: TERMINAL_TOOLBAR_ACTIONS_POINT,
        ownerId: 'terminal',
        label: 'Terminal toolbar',
        kind: 'remote',
        mode: 'stack',
        max: 4,
        actions: ['interrupt'],
      }),
    )
    listen = vi.spyOn(HTMLElement.prototype, 'addEventListener')
  })
  afterEach(() => {
    listen.mockRestore()
    for (const registration of registered.splice(0).reverse()) registration.dispose()
  })

  it('draws four contributors and a count between the drawer’s own controls and Hide', async () => {
    for (const id of ['a', 'b', 'c', 'd', 'e']) contributor(id)
    mount()
    await settle()

    const actions = document.querySelector('.ui-doctabs-actions')!
    const labels = [...actions.querySelectorAll('button')].map(
      (button) => button.getAttribute('aria-label') ?? button.textContent,
    )
    expect(labels).toEqual(['New terminal', 'Stop', 'a', 'b', 'c', 'd', 'Hide terminals'])
    expect(actions.textContent).toContain('1 more from other plugins')
    expect(latest('a')).toMatchObject({ taskId: 't1', session: { id: A, title: 'first', running: true } })
  })

  it('interrupts only the selected running session, and only when a person pressed inside the contributor', async () => {
    contributor('stopper')
    contributor('other')
    mount()
    await settle()
    const host = latest('stopper').host

    await expect(host.invoke('interrupt', { expectedSessionId: A })).resolves.toEqual({
      ok: false,
      reason: 'needs_person',
    })
    // A press in another plugin's control is not a press in this one.
    press('other')
    await expect(host.invoke('interrupt', { expectedSessionId: A })).resolves.toEqual({
      ok: false,
      reason: 'needs_person',
    })
    press('stopper')
    // A supplied ID that isn't the selected session is refused, even though that session is running.
    await expect(host.invoke('interrupt', { expectedSessionId: B })).resolves.toEqual({ ok: false, reason: 'changed' })
    await expect(host.invoke('interrupt', { expectedSessionId: A })).resolves.toEqual({ ok: true })
    expect(interrupts).toEqual([A])
    // Nothing but the declared action reaches the drawer.
    await expect(host.invoke('write', { data: 'rm -rf /\n' })).rejects.toMatchObject({ code: 'unknown_action' })
  })

  it('follows the selected session with one mount, and refuses one that changed, stopped, or vanished', async () => {
    contributor('stopper')
    mount()
    await settle()
    const mounts = drawn.length
    const host = latest('stopper').host
    press('stopper')

    tab(B)?.click()
    await settle()
    expect(latest('stopper').session).toEqual({ id: B, title: 'second', running: true })
    expect(drawn).toHaveLength(mounts)
    await expect(host.invoke('interrupt', { expectedSessionId: A })).resolves.toEqual({ ok: false, reason: 'changed' })

    roster = [session(A, 'first'), { ...session(B, 'second'), status: 'exited' }]
    await refreshSessions()
    await settle()
    expect(latest('stopper').session).toEqual({ id: B, title: 'second', running: false })
    press('stopper')
    await expect(host.invoke('interrupt', { expectedSessionId: B })).resolves.toEqual({ ok: false, reason: 'changed' })

    roster = [session(A, 'first')]
    await refreshSessions()
    await settle()
    press('stopper')
    await expect(host.invoke('interrupt', { expectedSessionId: B })).resolves.toEqual({ ok: false, reason: 'changed' })
    expect(interrupts).toEqual([])
  })

  it('remounts on a task switch, so the old mount cannot interrupt the new task’s session', async () => {
    roster = [session(A, 'first'), session(B, 'second', 't2')]
    contributor('stopper')
    const [current, setCurrent] = createSignal(task)
    mount({ task: current })
    await settle()
    const before = latest('stopper').host
    // Pressed in the old task's mount, just before the switch, so only the identity check is left.
    press('stopper')

    setCurrent({ id: 't2', title: 'second task' } as Task)
    await settle()
    expect(latest('stopper')).toMatchObject({ taskId: 't2', session: { id: B } })
    expect(latest('stopper').host).not.toBe(before)
    await expect(before.invoke('interrupt', { expectedSessionId: B })).resolves.toEqual({
      ok: false,
      reason: 'changed',
    })
    expect(interrupts).toEqual([])
  })

  it('drops a contributor whose registration goes, and keeps the drawer’s own Stop', async () => {
    const registration = contributor('stopper')
    mount()
    await settle()
    expect(document.querySelector('[data-contributor="stopper"]')).not.toBeNull()

    registration.dispose()
    await settle()
    expect(document.querySelector('[data-contributor="stopper"]')).toBeNull()
    document.querySelector<HTMLButtonElement>('button[aria-label="Stop"]')!.click()
    expect(interrupts).toEqual([A])
  })
})
