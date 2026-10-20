import type { BrowserApi, MessageSender, Port, Tab } from '../browser'

// The one fake of the extension API, shared by background and sidebar tests. It models what those
// tests depend on: asynchronous port delivery, both browsers' ways of reporting a closed port,
// profile storage, a native host the test scripts, the active tab page capture reads, messages to and
// from a page's content script, the right-click menu, and optional host access. Native messaging itself, the browser's
// permission prompt, gestures, and real selectors are checked in a browser through `pnpm dev:extension`.

type Listener = (...args: never[]) => void
function listeners<L extends Listener>() {
  const set = new Set<L>()
  return {
    addListener: (listener: L) => void set.add(listener),
    removeListener: (listener: L) => void set.delete(listener),
    // Whether any listener returned `true`, which keeps a message's answer channel open.
    emit: (...args: Parameters<L>): boolean => {
      let kept = false
      for (const listener of set) if ((listener(...args) as unknown) === true) kept = true
      return kept
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
  const onMessage =
    listeners<(message: unknown, sender: MessageSender, sendResponse: (response: unknown) => void) => true | void>()
  const onUpdated = listeners<(tabId: number, change: { url?: string; status?: string }, tab: Tab) => void>()
  const onActivated = listeners<(info: { tabId: number; windowId: number }) => void>()
  const onTabRemoved = listeners<(tabId: number) => void>()
  const onAdded = listeners<(permissions: { origins?: string[]; permissions?: string[] }) => void>()
  const onRemoved = listeners<(permissions: { origins?: string[]; permissions?: string[] }) => void>()
  const onStorageChanged = listeners<(changes: Record<string, { newValue?: unknown }>, area: string) => void>()
  const onNotificationClicked = listeners<(id: string) => void>()
  const onInstalled = listeners<() => void>()
  const onMenuClicked = listeners<(info: { menuItemId: string | number; frameId?: number }, tab?: Tab) => void>()
  // A port from an extension page, or from a content script, as `sender` says.
  const connect = (name: string, sender: MessageSender): Port => {
    const close = (end: FakePort) => {
      for (const side of [end, end.peer!]) side.closed = true
      queueMicrotask(() => end.peer!.onDisconnect.emit(end.peer!))
    }
    const opener = port(name, close)
    const receiver = Object.assign(port(name, close), { sender })
    opener.peer = receiver
    receiver.peer = opener
    queueMicrotask(() => onConnect.emit(receiver))
    return opener
  }
  const runtime: BrowserApi['runtime'] = {
    lastError: null,
    getURL: (path) => `chrome-extension://fake/${path}`,
    onConnect,
    onMessage,
    onInstalled,
    sendMessage: async (message) => void onMessage.emit(structuredClone(message), {}, () => {}),
    connect: ({ name }) => connect(name, { url: runtime.getURL('sidebar.html') }),
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
    // The extension was installed, and the right-click entries it made then, by ID.
    install: () => onInstalled.emit(),
    menus: new Map<string, { title: string; contexts: string[] }>(),
    // A right-click entry, clicked on the active tab, in its top frame unless `frameId` says otherwise.
    clickMenu: (menuItemId: string, frameId = 0) => onMenuClicked.emit({ menuItemId, frameId }, { ...fake.activeTab }),
    // Whether the browser refuses to open the panel, as it does outside a gesture it counts.
    refusePanel: false,
    // The tab beside the sidebar. Without `url` the extension may not read it, as without activeTab.
    activeTab: { id: 1, windowId: 1, url: 'https://example.test/docs', title: 'Docs' } as Tab,
    // Tabs in the background of the window, which `tabs.query({})` lists after the active one.
    otherTabs: [] as Tab[],
    // The toolbar badge text for each tab, as last set.
    badges: new Map<number, string>(),
    // OS notifications on screen, by ID, and every one ever created, in order.
    notifications: new Map<string, { title: string; message: string }>(),
    notified: [] as string[],
    clickNotification: (id: string): void => void onNotificationClicked.emit(id),
    selection: '',
    // Replaced by a test to script what a page's content scripts answer. By default, nothing.
    pageAnswer: (_message: unknown): unknown => undefined,
    // Messages the background sent to a page's content scripts, the tabs it injected scripts into, and
    // the files it injected.
    tabMessages: [] as { tabId: number; message: unknown }[],
    injected: [] as number[],
    injectedFiles: [] as string[][],
    // A message from a content script in the active tab, in its top frame unless `frameId` says
    // otherwise, as the browser delivers it. Resolves with the background's answer, if it gives one.
    // `senderUrl` stands in for Firefox, which keeps it at the page the script loaded on.
    sendFromPage: (message: unknown, frameId = 0, senderUrl?: string): Promise<unknown> =>
      new Promise((resolve) => {
        const kept = onMessage.emit(
          structuredClone(message),
          { tab: { ...fake.activeTab }, url: senderUrl ?? fake.activeTab.url, frameId },
          (answer) => resolve(structuredClone(answer)),
        )
        // A browser answers `undefined` when no listener kept the channel open.
        if (!kept) resolve(undefined)
      }),
    // A port a content script in the active tab opened.
    connectFromPage: (name: string): Port => connect(name, { tab: { ...fake.activeTab }, url: fake.activeTab.url }),
    // The active tab navigated, as `tabs.onUpdated` reports it.
    navigate: (url: string | undefined): void => {
      fake.activeTab = { ...fake.activeTab, url }
      onUpdated.emit(fake.activeTab.id!, { url, status: 'complete' }, { ...fake.activeTab, active: true })
    },
    activate: (): void => void onActivated.emit({ tabId: fake.activeTab.id!, windowId: fake.activeTab.windowId }),
    // A background tab closed.
    closeTab: (tabId: number): void => {
      fake.otherTabs = fake.otherTabs.filter((tab) => tab.id !== tabId)
      onTabRemoved.emit(tabId)
    },
    // Tabs the extension brought forward, windows it focused, and addresses it opened in new tabs.
    shownTabs: [] as number[],
    focusedWindows: [] as number[],
    createdTabs: [] as string[],
    // Optional host access the person granted. `answerRequest` is the person's answer to the prompt.
    granted: new Set<string>(),
    answerRequest: true,
    revoke: (origin: string): void => {
      fake.granted.delete(origin)
      onRemoved.emit({ origins: [origin] })
    },
    // An API permission, such as `notifications`, granted or taken away outside the extension.
    grantPermission: (name: string): void => {
      fake.granted.add(name)
      onAdded.emit({ permissions: [name] })
    },
    revokePermission: (name: string): void => {
      fake.granted.delete(name)
      onRemoved.emit({ permissions: [name] })
    },
    // Replaced by a test to script a screenshot. By default a small JPEG.
    onCapture: async (_windowId: number): Promise<string> => 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
    api: {
      runtime,
      storage: {
        local: {
          get: async (keys) =>
            Object.fromEntries(keys.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)])),
          set: async (items) => {
            for (const [key, value] of Object.entries(items)) storage.set(key, structuredClone(value))
            onStorageChanged.emit(
              Object.fromEntries(Object.entries(items).map(([key, value]) => [key, { newValue: value }])),
              'local',
            )
          },
          remove: async (keys) => {
            for (const key of keys) storage.delete(key)
            onStorageChanged.emit(Object.fromEntries(keys.map((key) => [key, {}])), 'local')
          },
        },
        onChanged: onStorageChanged,
      },
      action: {
        onClicked,
        setBadgeText: async ({ tabId, text }: { tabId?: number; text: string }) =>
          void fake.badges.set(tabId ?? -1, text),
        setBadgeBackgroundColor: async () => undefined,
      },
      tabs: {
        // Like Firefox 151, an `active` query leaves out the address a wider query reports.
        query: async (query: { active?: true }): Promise<Tab[]> =>
          query.active
            ? [{ ...fake.activeTab, active: true, url: undefined }]
            : [{ ...fake.activeTab, active: true }, ...fake.otherTabs.map((tab) => ({ ...tab, active: false }))],
        captureVisibleTab: (windowId: number): Promise<string> => fake.onCapture(windowId),
        // As in a browser, a tab with no script injected has nothing to take the message.
        sendMessage: async (tabId: number, message: unknown): Promise<unknown> => {
          if (!fake.injected.includes(tabId))
            throw new Error('Could not establish connection. Receiving end does not exist.')
          fake.tabMessages.push({ tabId, message: structuredClone(message) })
          return fake.pageAnswer(message)
        },
        update: async (tabId: number) => void fake.shownTabs.push(tabId),
        create: async ({ url }: { url: string }) => void fake.createdTabs.push(url),
        onUpdated,
        onActivated,
        onRemoved: onTabRemoved,
      },
      windows: {
        update: async (windowId: number) => void fake.focusedWindows.push(windowId),
      },
      contextMenus: {
        create: ({ id, title, contexts }: { id: string; title: string; contexts: string[] }) =>
          void fake.menus.set(id, { title, contexts }),
        onClicked: onMenuClicked,
      },
      scripting: {
        executeScript: (async (injection: { target: { tabId: number }; files?: string[] }) => {
          if (fake.activeTab.url === undefined) throw new Error('Missing host permission for the tab')
          if (injection.files) {
            fake.injected.push(injection.target.tabId)
            fake.injectedFiles.push(injection.files)
            return [{}]
          }
          return [{ result: fake.selection }]
        }) as BrowserApi['scripting']['executeScript'],
      },
      // Host patterns and API permission names share one set of grants.
      permissions: {
        contains: async ({ origins = [], permissions = [] }): Promise<boolean> =>
          [...origins, ...permissions].every((name) => fake.granted.has(name)),
        request: async ({ origins = [], permissions = [] }): Promise<boolean> => {
          if (!fake.answerRequest) return false
          for (const name of [...origins, ...permissions]) fake.granted.add(name)
          onAdded.emit({ origins, permissions })
          return true
        },
        remove: async ({ origins = [], permissions = [] }): Promise<boolean> => {
          for (const origin of origins) fake.revoke(origin)
          for (const name of permissions) fake.revokePermission(name)
          return true
        },
        onAdded,
        onRemoved,
      },
      // As in a browser, the API is there only while its permission is granted.
      get notifications(): BrowserApi['notifications'] {
        if (!fake.granted.has('notifications')) return undefined
        return {
          create: async (id: string, options: { title: string; message: string }) => {
            fake.notifications.set(id, { title: options.title, message: options.message })
            fake.notified.push(id)
            return id
          },
          clear: async (id: string) => fake.notifications.delete(id),
          onClicked: onNotificationClicked,
        }
      },
      ...(flavor === 'chrome'
        ? {
            sidePanel: {
              setPanelBehavior: async (behavior: { openPanelOnActionClick: boolean }) =>
                void (fake.panelBehavior = behavior),
              open: async ({ windowId }: { windowId: number }) => void fake.openPanel(windowId),
            },
          }
        : { sidebarAction: { open: async () => void fake.openPanel(null) } }),
    } satisfies BrowserApi as BrowserApi,
    panelBehavior: null as { openPanelOnActionClick: boolean } | null,
    // Each opening of the panel: the window in Chrome, null in Firefox, whose sidebar has no window.
    panelOpens: [] as (number | null)[],
    openPanel: (windowId: number | null): void => {
      if (fake.refusePanel) throw new Error('sidePanel.open() may only be called in response to a user gesture.')
      fake.panelOpens.push(windowId)
    },
  }
  return fake
}

// Settles queued port deliveries and the promise work they start.
export const settle = async (turns = 10): Promise<void> => {
  for (let turn = 0; turn < turns; turn++) await new Promise((resolve) => setTimeout(resolve, 0))
}
