import type { BrowserApi, MessageSender, Port, Tab } from '../browser'

// The one fake of the extension API, shared by background and sidebar tests. It models what those
// tests depend on: asynchronous port delivery, both browsers' ways of reporting a closed port,
// profile storage, a native host the test scripts, the active tab page capture reads, messages to and
// from a page's content script, and optional host access. Native messaging itself, the browser's
// permission prompt, gestures, and real selectors are checked in a browser through `pnpm dev:extension`.

type Listener = (...args: never[]) => void
function listeners<L extends Listener>() {
  const set = new Set<L>()
  return {
    addListener: (listener: L) => void set.add(listener),
    removeListener: (listener: L) => void set.delete(listener),
    emit: (...args: Parameters<L>) => {
      for (const listener of set) listener(...args)
    },
  }
}

type FakePort = Omit<Port, 'onMessage' | 'onDisconnect'> & {
  onMessage: ReturnType<typeof listeners<(message: unknown, port: Port) => void>>
  onDisconnect: ReturnType<typeof listeners<(port: Port) => void>>
  peer?: FakePort
  closed: boolean
}

function port(name: string, close: (port: FakePort) => void): FakePort {
  const onMessage = listeners<(message: unknown, port: Port) => void>()
  const onDisconnect = listeners<(port: Port) => void>()
  const created: FakePort = {
    name,
    closed: false,
    error: null,
    onMessage,
    onDisconnect,
    postMessage(message) {
      if (created.closed) throw new Error('Attempt to postMessage on disconnected port')
      // Structured clone, delivered on a later turn, as a browser does.
      const copy = structuredClone(message)
      queueMicrotask(() => created.peer && !created.peer.closed && created.peer.onMessage.emit(copy, created.peer))
    },
    disconnect() {
      close(created)
    },
  }
  return created
}

// What the fake native host sees: each request, a way to answer it, and a way to close the port.
export type FakeHost = {
  received: unknown[]
  send(message: unknown): void
  close(reason?: string): void
}

export function fakeBrowser(options: { flavor?: 'chrome' | 'firefox' } = {}) {
  const flavor = options.flavor ?? 'chrome'
  const storage = new Map<string, unknown>()
  const onConnect = listeners<(port: Port) => void>()
  const onClicked = listeners<(tab: Tab) => void>()
  const onMessage = listeners<(message: unknown, sender: MessageSender) => void>()
  const onUpdated = listeners<(tabId: number, change: { url?: string; status?: string }, tab: Tab) => void>()
  const onActivated = listeners<(info: { tabId: number; windowId: number }) => void>()
  const onAdded = listeners<(permissions: { origins?: string[] }) => void>()
  const onRemoved = listeners<(permissions: { origins?: string[] }) => void>()
  const runtime: BrowserApi['runtime'] = {
    lastError: null,
    onConnect,
    onMessage,
    sendMessage: async (message) => void onMessage.emit(structuredClone(message), {}),
    connect({ name }) {
      const close = (end: FakePort) => {
        for (const side of [end, end.peer!]) side.closed = true
        queueMicrotask(() => end.peer!.onDisconnect.emit(end.peer!))
      }
      const sidebar = port(name, close)
      const background = port(name, close)
      sidebar.peer = background
      background.peer = sidebar
      queueMicrotask(() => onConnect.emit(background))
      return sidebar
    },
    connectNative(application) {
      const hostEnd = port(application, () => {})
      const extensionEnd = port(application, () => {
        extensionEnd.closed = true
      })
      extensionEnd.peer = hostEnd
      hostEnd.peer = extensionEnd
      const host: FakeHost = {
        received: [],
        send: (message) => hostEnd.postMessage(message),
        // The browser reports the reason on the port in Firefox and in runtime.lastError in Chrome.
        close(reason) {
          extensionEnd.closed = true
          queueMicrotask(() => {
            if (flavor === 'firefox') extensionEnd.error = reason ? { message: reason } : null
            else runtime.lastError = reason ? { message: reason } : null
            extensionEnd.onDisconnect.emit(extensionEnd)
            runtime.lastError = null
          })
        },
      }
      hostEnd.onMessage.addListener((message) => {
        host.received.push(message)
        fake.onNativeMessage(message, host)
      })
      fake.hosts.push(host)
      queueMicrotask(() => fake.onNativeConnect(host))
      return extensionEnd
    },
  }
  const fake = {
    storage,
    hosts: [] as FakeHost[],
    // Replaced by a test to script the host. By default a host answers nothing.
    onNativeConnect: (_host: FakeHost): void => {},
    onNativeMessage: (_message: unknown, _host: FakeHost): void => {},
    // The toolbar button, clicked on the active tab.
    clickAction: () => onClicked.emit({ ...fake.activeTab }),
    // The tab beside the sidebar. Without `url` the extension may not read it, as without activeTab.
    activeTab: { id: 1, windowId: 1, url: 'https://example.test/docs', title: 'Docs' } as Tab,
    selection: '',
    // Messages the background sent to a page's content script, and the tabs it injected one into.
    tabMessages: [] as { tabId: number; message: unknown }[],
    injected: [] as number[],
    // A message from the content script in the active tab, as the browser delivers it.
    sendFromPage: (message: unknown): void =>
      onMessage.emit(structuredClone(message), { tab: { ...fake.activeTab }, url: fake.activeTab.url, frameId: 0 }),
    // The active tab navigated, as `tabs.onUpdated` reports it.
    navigate: (url: string | undefined): void => {
      fake.activeTab = { ...fake.activeTab, url }
      onUpdated.emit(fake.activeTab.id!, { url, status: 'complete' }, { ...fake.activeTab })
    },
    activate: (): void => onActivated.emit({ tabId: fake.activeTab.id!, windowId: fake.activeTab.windowId }),
    // Optional host access the person granted. `answerRequest` is the person's answer to the prompt.
    granted: new Set<string>(),
    answerRequest: true,
    revoke: (origin: string): void => {
      fake.granted.delete(origin)
      onRemoved.emit({ origins: [origin] })
    },
    // Replaced by a test to script a screenshot. By default a small JPEG.
    onCapture: async (_windowId: number): Promise<string> => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    api: {
      runtime,
      storage: {
        local: {
          get: async (keys) =>
            Object.fromEntries(keys.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)])),
          set: async (items) => void Object.entries(items).forEach(([key, value]) => storage.set(key, value)),
          remove: async (keys) => void keys.forEach((key) => storage.delete(key)),
        },
      },
      action: { onClicked },
      tabs: {
        query: async (): Promise<Tab[]> => [{ ...fake.activeTab }],
        captureVisibleTab: (windowId: number): Promise<string> => fake.onCapture(windowId),
        sendMessage: async (tabId: number, message: unknown) =>
          void fake.tabMessages.push({ tabId, message: structuredClone(message) }),
        onUpdated,
        onActivated,
      },
      scripting: {
        executeScript: (async (injection: { target: { tabId: number }; files?: string[] }) => {
          if (fake.activeTab.url === undefined) throw new Error('Missing host permission for the tab')
          if (injection.files) {
            fake.injected.push(injection.target.tabId)
            return [{}]
          }
          return [{ result: fake.selection }]
        }) as BrowserApi['scripting']['executeScript'],
      },
      permissions: {
        contains: async ({ origins }: { origins: string[] }): Promise<boolean> =>
          origins.every((origin) => fake.granted.has(origin)),
        request: async ({ origins }: { origins: string[] }): Promise<boolean> => {
          if (!fake.answerRequest) return false
          for (const origin of origins) fake.granted.add(origin)
          onAdded.emit({ origins })
          return true
        },
        remove: async ({ origins }: { origins: string[] }): Promise<boolean> => {
          for (const origin of origins) fake.revoke(origin)
          return true
        },
        onAdded,
        onRemoved,
      },
      ...(flavor === 'chrome'
        ? {
            sidePanel: {
              setPanelBehavior: async (behavior: { openPanelOnActionClick: boolean }) =>
                void (fake.panelBehavior = behavior),
              open: async ({ windowId }: { windowId: number }) => void fake.panelOpens.push(windowId),
            },
          }
        : { sidebarAction: { open: async () => void fake.panelOpens.push(null) } }),
    } satisfies BrowserApi as BrowserApi,
    panelBehavior: null as { openPanelOnActionClick: boolean } | null,
    // Each opening of the panel: the window in Chrome, null in Firefox, whose sidebar has no window.
    panelOpens: [] as (number | null)[],
  }
  return fake
}

// Settles queued port deliveries and the promise work they start.
export const settle = async (turns = 10): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}
