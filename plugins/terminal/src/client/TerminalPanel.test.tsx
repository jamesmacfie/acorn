import { render } from 'solid-js/web'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import type { ServerMsg, TerminalSession } from '@acorn/protocol/terminal.ts'
import type { Task } from '@acorn/plugin-api/client'

// What a terminal tab switch costs, in jsdom. This is the tier the drawer never had, and phase 6 of
// the performance programme is the reason it needs one: the panel used to mount the active tab alone,
// so every switch destroyed an xterm and its WebGL context and asked the node to serialize a
// thousand-line framebuffer, and nothing short of a person clicking tabs would notice a regression
// back to that (docs/future/performance/phase-6-terminals-work-only-when-watched.md).
//
// The real `TerminalSurface` runs here. What is stubbed is xterm, because it draws to a canvas and
// jsdom has no layout to draw into; everything this file is about — when a surface is built, when it
// attaches, and whether its element survives — is the shipped code.

class StubTerminal {
  static built = 0
  cols = 80
  rows = 24
  options: Record<string, unknown>
  disposed = false

  constructor(options: Record<string, unknown>) {
    StubTerminal.built += 1
    this.options = options
  }

  loadAddon(): void {}
  open(): void {}
  write(): void {}
  focus(): void {}
  attachCustomKeyEventHandler(): void {}
  onData(): void {}
  onResize(): void {}
  dispose(): void {
    this.disposed = true
  }
}

vi.mock('@xterm/xterm', () => ({ Terminal: StubTerminal }))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/addon-webgl', () => ({ WebglAddon: class { onContextLoss(): void {} dispose(): void {} } }))
// Shiki sits behind the real one, and an ANSI palette is not what this file is about.
vi.mock('./theme', () => ({ baseTheme: () => ({}), monoFont: () => 'monospace', xtermTheme: async () => ({}) }))

const attaches: string[] = []
const detaches: string[] = []
vi.mock('./terminalClient', () => ({
  terminalApi: () => ({
    profiles: async () => [],
    resize: async () => true,
    write: () => {},
    interrupt: async () => true,
    remove: async () => true,
    attach: (id: string, _on: (m: ServerMsg) => void) => {
      attaches.push(id)
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
const { refreshSessions } = await import('@acorn/plugin-api/client')

const A = '11111111-2222-3333-4444-555555555555'
const B = '99999999-8888-7777-6666-555555555555'

const session = (id: string, title: string): TerminalSession =>
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
    taskId: 't1',
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
  roster = [session(A, 'first'), session(B, 'second')]
  vi.stubGlobal('fetch', async (url: string) =>
    new Response(JSON.stringify(String(url).endsWith('/sessions') ? roster : {}), { status: 200, headers: { 'content-type': 'application/json' } }),
  )
})

afterEach(async () => {
  for (const dispose of cleanups.splice(0)) dispose()
  document.body.replaceChildren()
  attaches.length = 0
  detaches.length = 0
  StubTerminal.built = 0
  roster = []
  await refreshSessions()
  vi.unstubAllGlobals()
})

// Solid's effects, the roster read and the surface's own requestAnimationFrame all settle on later
// turns.
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

// The `Drawer` host component draws the dock itself, into the document rather than into whatever
// element rendered the plugin's panel, so both readers below look at the document.
const mount = (): void => {
  const host = document.createElement('div')
  document.body.append(host)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  cleanups.push(
    render(
      () => (
        <QueryClientProvider client={client}>
          <TerminalPanel task={task} onClose={() => {}} />
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
    expect(StubTerminal.built).toBe(1)

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
    expect(StubTerminal.built).toBe(2)
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
