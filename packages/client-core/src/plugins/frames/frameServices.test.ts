import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { prefsKey } from '@acorn/protocol/api.ts'
import type { QueryClient } from '@tanstack/solid-query'
import type { FrameBinding } from './broker'
import type { PluginFrameProps } from './frameServices'

const sendRaw = vi.fn(async (..._args: unknown[]) => ({ ok: true, status: 200, body: null }))
vi.mock('../../apiClient', () => ({
  readJson: vi.fn(),
  sendRaw: (...args: unknown[]) => sendRaw(...args),
  writeJson: vi.fn(),
}))

// The host ladder, as ONE call now. It used to be `parseInAppTarget` then `openContentTarget`, and the
// frame side had to hold the target in between; `openInAppUrl` owns the whole question, including the
// route rung this surface previously had no way to reach.
const openInAppUrl = vi.fn((..._args: unknown[]) => false)

vi.mock('../../registries/contentLinks', () => ({
  openInAppUrl: (...args: unknown[]) => openInAppUrl(...args),
}))

const openPane = vi.fn()
vi.mock('../../registries/clientEvents', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../registries/clientEvents')>()),
  openPane: (...args: unknown[]) => openPane(...args),
}))

const toast = vi.fn()
vi.mock('../../notifications/toast', () => ({ toast: (...args: unknown[]) => toast(...args) }))

const saveJsonPref = vi.fn(async (..._args: unknown[]) => undefined)
vi.mock('../../settings/savePref', () => ({ saveJsonPref: (...args: unknown[]) => saveJsonPref(...args) }))

const { createFrameServices } = await import('./frameServices')

// The host half of the frame bridge (docs/plugins.md).
//
// broker.test.ts pins what the CHECKER refuses; this pins what the host then actually does with a call
// that got through. The two halves used to sit on opposite sides of a `.tsx` boundary, so only one of
// them could be tested — and the effects are the half that pins a node, hand-parses the prefs cache and
// decides where a link goes.

const binding = (over: Partial<FrameBinding> = {}): FrameBinding => ({
  pluginId: 'board',
  surface: 'board-pane',
  target: 'pane',
  nodeId: 'node-a',
  api: [],
  events: [],
  panes: ['board-pane'],
  claimsKeys: [],
  ...over,
})

// Just enough query client for the two verbs that read the prefs cache.
const queryClient = (prefs: Record<string, string> = {}): QueryClient =>
  ({ getQueryData: (key: unknown) => (JSON.stringify(key) === JSON.stringify(prefsKey) ? prefs : undefined) }) as unknown as QueryClient

export const navigated: string[] = []

const build = (props: Partial<PluginFrameProps> = {}, over: { prefs?: Record<string, string>; focus?: boolean } = {}) =>
  createFrameServices(
    { binding: binding(), hash: 'a'.repeat(64), ...props },
    { qc: queryClient(over.prefs), frameHasFocus: () => over.focus ?? false, navigate: (to) => void navigated.push(to) },
  )

const windowOpen = vi.fn()

beforeEach(() => {
  sendRaw.mockClear()
  openPane.mockClear()
  toast.mockClear()
  saveJsonPref.mockClear()
  openInAppUrl.mockReset()
  openInAppUrl.mockReturnValue(false)
  windowOpen.mockClear()
  vi.stubGlobal('window', { open: windowOpen })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetch', () => {
  it('pins the frame’s own node, which no message can name', () => {
    const services = build({ binding: binding({ nodeId: 'node-b' }) })
    void services.fetch('GET', '/v2/p/board/items', undefined, new AbortController().signal)
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/board/items', expect.objectContaining({ method: 'GET', nodeId: 'node-b' }))
  })

  it('sends a body as JSON and omits the header when there is none', () => {
    const signal = new AbortController().signal
    void build().fetch('POST', '/v2/p/board/items', { title: 'x' }, signal)
    expect(sendRaw).toHaveBeenCalledWith('/v2/p/board/items', expect.objectContaining({
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'x' }),
    }))
    void build().fetch('DELETE', '/v2/p/board/items/1', undefined, signal)
    expect(sendRaw.mock.calls.at(-1)?.[1]).not.toHaveProperty('body')
  })
})

describe('subscribe', () => {
  it('refuses a real shell channel that is not on the frame list', () => {
    // `presentation:pane-intent` exists and is emitted constantly — it is simply the shell's own
    // intent traffic, which a plugin has no business watching (./channels.ts). The broker checks the
    // manifest DECLARED a channel; this checks the shell offers it, and neither check creates one.
    expect(() => build().subscribe('presentation:pane-intent', () => {})).toThrow(/not a channel a plugin frame can subscribe to/)
  })

  it('attaches to one that does and detaches on the returned handle', async () => {
    const { clientEvents } = await import('../../registries/clientEvents')
    const seen: unknown[] = []
    const off = build().subscribe('runtime:task-archived', (payload) => seen.push(payload))
    clientEvents.emit('runtime:task-archived', { taskId: 'task-1' })
    off()
    clientEvents.emit('runtime:task-archived', { taskId: 'task-1' })
    expect(seen).toHaveLength(1)
  })
})

describe('plugin state', () => {
  it('parses what saveJsonPref wrote', () => {
    const key = 'plugin.board.filters'
    expect(build({}, { prefs: { [key]: JSON.stringify({ mine: true }) } }).stateGet(key)).toEqual({ mine: true })
  })

  it('reports a value some other writer put there as absent', () => {
    // Not this plugin's state, so it is not handed over as a string either.
    expect(build({}, { prefs: { 'plugin.board.filters': 'not json' } }).stateGet('plugin.board.filters')).toBeUndefined()
    expect(build().stateGet('plugin.board.filters')).toBeUndefined()
  })

  it('writes through the shared pref writer', async () => {
    await build().stateSet('plugin.board.filters', { mine: true })
    expect(saveJsonPref).toHaveBeenCalledWith(expect.anything(), 'plugin.board.filters', { mine: true })
  })
})

describe('openPane', () => {
  it('opens into the frame’s bound task', () => {
    build({ binding: binding({ taskId: 'task-1' }) }).openPane('board-pane')
    expect(openPane).toHaveBeenCalledWith('task-1', 'board-pane')
  })

  it('does nothing for a frame with no task', () => {
    // A pane is a slot in a task's layout, so a settings modal or a project surface has nothing to open
    // into. The broker's allowlist check is separate and comes first; this is the second wall.
    build().openPane('board-pane')
    expect(openPane).not.toHaveBeenCalled()
  })
})

describe('openUrl', () => {
  it('falls through to the owner’s browser when nothing in-app claims it', () => {
    build().openUrl('https://example.com/thing')
    expect(windowOpen).toHaveBeenCalledWith('https://example.com/thing', '_blank', 'noopener,noreferrer')
  })

  it('keeps an in-app target in-app', () => {
    openInAppUrl.mockReturnValue(true)
    build({ binding: binding({ taskId: 'task-1' }) }).openUrl('https://board.example/cards/ENG-1')
    expect(openInAppUrl).toHaveBeenCalledWith('https://board.example/cards/ENG-1', expect.objectContaining({ taskId: 'task-1' }))
    expect(windowOpen).not.toHaveBeenCalled()
  })

  it('prefers the reference panel from inside one, and states nothing from everywhere else', () => {
    // The reader is looking sideways and asked to look sideways again; pushing a pane behind an overlay
    // they would then have to dismiss is not what they meant. Which rung wins comes from the SURFACE,
    // which is why the frame is never consulted.
    //
    // Stating NOTHING is the meaningful half of the second case. A pane or a project surface takes the
    // host's default order — pane, then panel, then route — rather than asking to be moved, so a link
    // clicked inside one cannot navigate the shell out from under the reader.
    openInAppUrl.mockReturnValue(true)
    build({ binding: binding({ target: 'refPanel', taskId: 'task-1' }) }).openUrl('https://linear.app/x/ENG-1')
    expect(openInAppUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: 'task-1', prefer: 'refPanel' }))

    build({ binding: binding({ taskId: 'task-1' }) }).openUrl('https://linear.app/x/ENG-1')
    expect(openInAppUrl.mock.lastCall?.[1]).not.toHaveProperty('prefer')
  })

  it('offers the shell navigator, so a frame’s link can reach a plugin route', () => {
    // The rung that made this surface reachable at all. The frame still names only a URL — where it goes
    // is the recogniser's answer, and the navigator is the host's.
    openInAppUrl.mockReturnValue(true)
    build().openUrl('https://github.com/runn/acorn/pull/9')
    expect(typeof (openInAppUrl.mock.lastCall?.[1] as { navigate?: unknown }).navigate).toBe('function')
  })

  it('never pushes a pane into a task the frame is not bound to', () => {
    // A project surface and a ref panel both sit beside something that is not a task layout, while a
    // task may well still be selected in the rail behind them. Reading the ambient one here would put a
    // pane into a background task's PERSISTED layout, where the reader is not and will not see it.
    build().openUrl('https://board.example/cards/ENG-1')
    expect(openInAppUrl).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ taskId: undefined }))
    expect(windowOpen).toHaveBeenCalled()
  })
})

describe('the structural grants', () => {
  it('offers no document verb unless a host editor shares the rectangle', () => {
    // The absence IS the permission check the broker applies — there is no scope to declare, because
    // the grant is structural.
    expect(build().document).toBeUndefined()
    expect(build({ document: () => ({ read: () => 'x', write: () => {}, flush: async () => {} }) }).document).toBeDefined()
  })

  it('reads the document per call, so a frame that connected first still reaches it', () => {
    // The editor may not exist yet when the frame mounts. Captured rather than read, that first
    // `document.read()` would land on nothing for the life of the pane.
    let editor: { read(): string; write(text: string): void; flush(): Promise<void> } | null = null
    const services = build({ document: () => editor })
    expect(services.document!.read()).toBe('')
    editor = { read: () => 'hello', write: () => {}, flush: async () => {} }
    expect(services.document!.read()).toBe('hello')
  })

  it('answers a webview verb with false when there is no webview', () => {
    expect(build().webviewNavigate!('https://example.com')).resolves.toBe(false)
    expect(build().webviewCommand!('back')).resolves.toBe(false)
  })

  it('turns the importer verbs into the host’s two callbacks', () => {
    const onImported = vi.fn()
    const onClose = vi.fn()
    const services = build({ onImported, onClose })
    services.importerDone()
    services.importerClose()
    expect([onImported, onClose].map((spy) => spy.mock.calls.length)).toEqual([1, 1])
    // A surface the host handed neither is a no-op rather than a throw: the broker gates these to
    // importer surfaces, and a second wall that crashes the frame is not a better wall.
    expect(() => build().importerDone()).not.toThrow()
  })

  it('delegates the focus evidence to the component that owns the iframe', () => {
    expect(build({}, { focus: true }).frameHasFocus()).toBe(true)
    expect(build({}, { focus: false }).frameHasFocus()).toBe(false)
  })
})

describe('toast', () => {
  it('joins a detail onto the title for the shared transient stack', () => {
    build().toast('Copied', 'to the clipboard')
    build().toast('Copied')
    expect(toast.mock.calls).toEqual([['Copied — to the clipboard'], ['Copied']])
  })
})
