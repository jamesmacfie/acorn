// The slice of the extension API this extension uses, typed once. Chrome exposes it as `chrome` and
// Firefox as `browser`; both return promises in Manifest V3. Tests supply the fake in
// src/test/fakeBrowser.ts instead.

type Listeners<Listener> = { addListener(listener: Listener): void; removeListener(listener: Listener): void }

export type Port = {
  name: string
  postMessage(message: unknown): void
  disconnect(): void
  onMessage: Listeners<(message: unknown, port: Port) => void>
  onDisconnect: Listeners<(port: Port) => void>
  // Firefox reports why a port closed here. Chrome uses runtime.lastError inside onDisconnect.
  error?: { message?: string } | null
}

export type Tab = { id?: number; windowId: number; active?: boolean; url?: string; title?: string }

// Who sent a one-off message: for a content script, its tab and the frame's address as the browser
// knows it, which the page can't change.
export type MessageSender = { tab?: Tab; url?: string; frameId?: number }

// Optional access: hosts by match pattern, or a named API permission such as `notifications`.
type Permissions = { origins?: string[]; permissions?: string[] }

export type BrowserApi = {
  runtime: {
    connectNative(application: string): Port
    connect(info: { name: string }): Port
    // The address of a file packaged with the extension.
    getURL(path: string): string
    onConnect: Listeners<(port: Port) => void>
    lastError?: { message?: string } | null
    // One-off messages between a page's content script and the background.
    sendMessage(message: unknown): Promise<unknown>
    onMessage: Listeners<(message: unknown, sender: MessageSender) => void>
    // The extension was installed, updated, or reloaded.
    onInstalled: Listeners<() => void>
  }
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string[]): Promise<void>
    }
    // Every write, from any page of the extension, with the area it was made in.
    onChanged: Listeners<(changes: Record<string, { newValue?: unknown; oldValue?: unknown }>, area: string) => void>
  }
  // A badge set for a tab shows only while that tab is active, and goes when the tab closes.
  action: {
    onClicked: Listeners<(tab: Tab) => void>
    setBadgeText(details: { tabId?: number; text: string }): Promise<void>
    setBadgeBackgroundColor(details: { color: string }): Promise<void>
  }
  // `url` and `title` are present only for a tab this extension may read: the one the toolbar button
  // was just clicked on (`activeTab`), or a site the person granted.
  tabs: {
    query(query: { active?: true; currentWindow?: true; windowId?: number }): Promise<Tab[]>
    captureVisibleTab(windowId: number, options: { format: 'jpeg'; quality: number }): Promise<string>
    sendMessage(tabId: number, message: unknown): Promise<unknown>
    // `change.url` is reported only for a tab this extension may read.
    onUpdated: Listeners<(tabId: number, change: { url?: string; status?: string }, tab: Tab) => void>
    onActivated: Listeners<(info: { tabId: number; windowId: number }) => void>
  }
  scripting: {
    executeScript<Result>(injection: { target: { tabId: number }; func: () => Result }): Promise<{ result?: Result }[]>
    executeScript(injection: { target: { tabId: number }; files: string[] }): Promise<unknown[]>
  }
  // Optional access, which only a person's click can grant.
  permissions: {
    contains(permissions: Permissions): Promise<boolean>
    request(permissions: Permissions): Promise<boolean>
    remove(permissions: Permissions): Promise<boolean>
    onAdded: Listeners<(permissions: Permissions) => void>
    onRemoved: Listeners<(permissions: Permissions) => void>
  }
  // Present once the person grants the optional `notifications` permission.
  notifications?: {
    create(id: string, options: { type: 'basic'; iconUrl: string; title: string; message: string }): Promise<string>
    clear(id: string): Promise<boolean>
    onClicked: Listeners<(id: string) => void>
  }
  // Right-click entries on web pages. The browser keeps them across background restarts, so they are
  // made once at install. A click grants `activeTab` for the tab it came from, as the toolbar button does.
  contextMenus: {
    create(item: { id: string; title: string; contexts: ['selection'] }): unknown
    onClicked: Listeners<(info: { menuItemId: string | number }, tab?: Tab) => void>
  }
  // Chrome only.
  sidePanel?: {
    setPanelBehavior(behavior: { openPanelOnActionClick: boolean }): Promise<void>
    open(options: { windowId: number }): Promise<void>
  }
  // Firefox only.
  sidebarAction?: { open(): Promise<void> }
}

export const browserApi = (): BrowserApi => {
  const scope = globalThis as { browser?: BrowserApi; chrome?: BrowserApi }
  const api = scope.browser ?? scope.chrome
  if (!api) throw new Error('No extension API is available on this page.')
  return api
}

// Why a port closed, in whichever form this browser reports it.
export const disconnectReason = (api: BrowserApi, port: Port): string | null =>
  port.error?.message ?? api.runtime.lastError?.message ?? null
