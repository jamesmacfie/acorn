import type { BrowserApi, Port } from '../browser'

// The one fake of the extension API, shared by background and sidebar tests. It models what those
// tests depend on: asynchronous port delivery, both browsers' ways of reporting a closed port,
// profile storage, and a native host the test scripts. Native messaging itself, permissions,
// gestures, and real selectors are checked in a browser through `pnpm dev:extension`.

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
  const onClicked = listeners<() => void>()
  const runtime: BrowserApi['runtime'] = {
    lastError: null,
    onConnect,
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
    clickAction: () => onClicked.emit(),
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
      ...(flavor === 'chrome'
        ? {
            sidePanel: {
              setPanelBehavior: async (behavior: { openPanelOnActionClick: boolean }) =>
                void (fake.panelBehavior = behavior),
            },
          }
        : { sidebarAction: { toggle: async () => void fake.sidebarToggles++ } }),
    } satisfies BrowserApi as BrowserApi,
    panelBehavior: null as { openPanelOnActionClick: boolean } | null,
    sidebarToggles: 0,
  }
  return fake
}

// Settles queued port deliveries and the promise work they start.
export const settle = async (turns = 10): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}
