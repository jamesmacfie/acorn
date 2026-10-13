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

export type Tab = { id?: number; windowId: number; url?: string; title?: string }

// Who sent a one-off message: for a content script, its tab and the frame's address as the browser
// knows it, which the page can't change.
export type MessageSender = { tab?: Tab; url?: string; frameId?: number }

type Origins = { origins: string[] }

export type BrowserApi = {
  runtime: {
    connectNative(application: string): Port
    connect(info: { name: string }): Port
    onConnect: Listeners<(port: Port) => void>
    lastError?: { message?: string } | null
    // One-off messages between a page's content script and the background.
    sendMessage(message: unknown): Promise<unknown>
    onMessage: Listeners<(message: unknown, sender: MessageSender) => void>
  }
  storage: {
    local: {
      get(keys: string[]): Promise<Record<string, unknown>>
      set(items: Record<string, unknown>): Promise<void>
      remove(keys: string[]): Promise<void>
    }
  }
  action: { onClicked: Listeners<(tab: Tab) => void> }
  // `url` and `title` are present only for a tab this extension may read: the one the toolbar button
  // was just clicked on (`activeTab`), or a site the person granted.
  tabs: {
    query(query: { active?: true; currentWindow?: true }): Promise<Tab[]>
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
  // Optional host access, which only a person's click can grant.
  permissions: {
    contains(permissions: Origins): Promise<boolean>
    request(permissions: Origins): Promise<boolean>
    remove(permissions: Origins): Promise<boolean>
    onAdded: Listeners<(permissions: Partial<Origins>) => void>
    onRemoved: Listeners<(permissions: Partial<Origins>) => void>
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
