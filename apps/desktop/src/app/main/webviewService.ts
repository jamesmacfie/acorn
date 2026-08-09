// Host-owned native web views. Callers identify a view with an opaque key and supply the policy
// that differs between products; Electron objects, partitions and navigation enforcement stay here.
//
// Preview is the first caller. Loaded-plugin surfaces are the second, and deliberately omit the
// attach hooks that make a preview drivable through CDP.
import { WebContentsView, type BrowserWindow, type WebContents } from 'electron'

export type ViewKey = string
export type ViewRect = { x: number; y: number; width: number; height: number }
export type ViewNavigationState = {
  key: ViewKey
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}
export type ViewBlockedState = { key: ViewKey; url: string; host: string }

export type ViewOptions = {
  key: ViewKey
  owner: BrowserWindow
  homeUrl: string
  // Electron treats a partition without `persist:` as in-memory. A caller may intentionally share an
  // ephemeral session by supplying the same key, but may never turn it into persistent storage.
  partitionKey?: string
  headersFor?: (url: string) => Record<string, string> | null
  onAttach?: (contents: WebContents) => void
  onDetach?: (contents: WebContents) => void
  onState?: (state: ViewNavigationState) => void
  onBlocked?: (state: ViewBlockedState) => void
  onDomReady?: (contents: WebContents) => void | Promise<void>
  // Additional caller-owned policy, such as a manifest host allowlist. The service always applies
  // the base HTTP(S)-without-userinfo rule before consulting this function.
  allowsNavigation?: (url: string) => boolean
}

type ViewRecord = {
  view: WebContentsView
  owner: BrowserWindow
  homeUrl: string
  options: ViewOptions
}

export type ViewCommand = 'back' | 'forward' | 'reload' | 'stop' | 'devtools'

const allowedBaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
  } catch {
    return false
  }
}

const blockedHost = (value: string): string => {
  try {
    return new URL(value).hostname
  } catch {
    return value
  }
}

export class WebviewService {
  readonly #records = new Map<ViewKey, ViewRecord>()
  readonly #trackedOwners = new WeakSet<BrowserWindow>()

  ensure(options: ViewOptions): boolean {
    if (!this.#allows(options, options.homeUrl)) return false
    let record = this.#records.get(options.key)
    if (record && (record.owner !== options.owner || record.view.webContents.isDestroyed())) {
      this.evict(options.key)
      record = undefined
    }
    if (!record) {
      this.#create(options)
      return true
    }

    // Keep callbacks current across renderer remounts. They carry no view authority: every operation
    // still resolves the record by its owner and opaque key.
    record.options = options
    if (record.homeUrl !== options.homeUrl) {
      record.homeUrl = options.homeUrl
      void record.view.webContents.loadURL(options.homeUrl)
    }
    return true
  }

  setBounds(owner: BrowserWindow, key: ViewKey, rect: ViewRect): boolean {
    const record = this.ownedRecord(owner, key)
    if (!record || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return false
    record.view.setBounds({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)),
      height: Math.max(0, Math.round(rect.height)),
    })
    return true
  }

  show(owner: BrowserWindow, key: ViewKey): boolean {
    const record = this.ownedRecord(owner, key)
    if (!record) return false
    record.view.setVisible(true)
    this.#emit(record, record.view.webContents.isLoading())
    return true
  }

  hide(owner: BrowserWindow, key: ViewKey): boolean {
    const record = this.ownedRecord(owner, key)
    if (!record) return false
    record.view.setVisible(false)
    return true
  }

  hideMatching(owner: BrowserWindow, predicate: (key: ViewKey) => boolean): void {
    for (const [key, record] of this.#records) {
      if (record.owner === owner && predicate(key)) record.view.setVisible(false)
    }
  }

  load(owner: BrowserWindow, key: ViewKey, url: string): boolean {
    const record = this.ownedRecord(owner, key)
    if (!record || !this.#allows(record.options, url)) return false
    void record.view.webContents.loadURL(url)
    return true
  }

  command(owner: BrowserWindow, key: ViewKey, action: ViewCommand): boolean {
    const wc = this.ownedRecord(owner, key)?.view.webContents
    if (!wc || wc.isDestroyed()) return false
    if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (action === 'reload') wc.reload()
    else if (action === 'stop') wc.stop()
    else if (action === 'devtools') {
      if (wc.isDevToolsOpened()) wc.closeDevTools()
      else wc.openDevTools({ mode: 'detach' })
    }
    return true
  }

  currentUrl(key: ViewKey): string | null {
    const wc = this.#records.get(key)?.view.webContents
    return wc && !wc.isDestroyed() ? wc.getURL() : null
  }

  navigationState(key: ViewKey): Omit<ViewNavigationState, 'key'> | null {
    const wc = this.#records.get(key)?.view.webContents
    if (!wc || wc.isDestroyed()) return null
    return {
      url: wc.getURL(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    }
  }

  loadByKey(key: ViewKey, url: string): boolean {
    const record = this.#records.get(key)
    if (!record || !this.#allows(record.options, url)) return false
    void record.view.webContents.loadURL(url)
    return true
  }

  commandByKey(key: ViewKey, action: Exclude<ViewCommand, 'devtools'>): boolean {
    const record = this.#records.get(key)
    return record ? this.command(record.owner, key, action) : false
  }

  evictOwned(owner: BrowserWindow, key: ViewKey): boolean {
    if (!this.ownedRecord(owner, key)) return false
    this.evict(key)
    return true
  }

  evict(key: ViewKey): boolean {
    const record = this.#records.get(key)
    if (!record) return false
    this.#records.delete(key)
    const wc = record.view.webContents
    record.options.onDetach?.(wc)
    try {
      record.owner.contentView.removeChildView(record.view)
    } catch {
      // The owner may already be closed or the view detached.
    }
    try {
      if (!wc.isDestroyed()) wc.close()
    } catch {
      // The guest renderer may already have closed.
    }
    return true
  }

  evictMatching(predicate: (key: ViewKey) => boolean): void {
    for (const key of this.#records.keys()) if (predicate(key)) this.evict(key)
  }

  ownedRecord(owner: BrowserWindow, key: unknown): ViewRecord | null {
    const record = typeof key === 'string' ? this.#records.get(key) : undefined
    return record?.owner === owner ? record : null
  }

  #create(options: ViewOptions): ViewRecord {
    const partition = options.partitionKey ?? `acorn-webview-${encodeURIComponent(options.key)}`
    if (partition.startsWith('persist:')) throw new Error('webview partitions must be ephemeral')
    const view = new WebContentsView({
      webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true },
    })
    const wc = view.webContents
    const session = wc.session
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.setPermissionCheckHandler(() => false)
    session.webRequest.onBeforeSendHeaders((details, callback) => {
      const extra = options.headersFor?.(details.url)
      callback({ requestHeaders: extra ? { ...details.requestHeaders, ...extra } : details.requestHeaders })
    })

    const record: ViewRecord = { view, owner: options.owner, homeUrl: options.homeUrl, options }
    const guard = (event: Electron.Event, url: string): void => {
      if (this.#allows(record.options, url)) return
      event.preventDefault()
      record.options.onBlocked?.({ key: record.options.key, url, host: blockedHost(url) })
    }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.setWindowOpenHandler(() => ({ action: 'deny' }))
    wc.on('did-start-loading', () => this.#emit(record, true))
    wc.on('did-stop-loading', () => this.#emit(record, false))
    wc.on('did-navigate', () => this.#emit(record, wc.isLoading()))
    wc.on('did-navigate-in-page', () => this.#emit(record, wc.isLoading()))
    wc.on('dom-ready', () => { void record.options.onDomReady?.(wc) })

    view.setVisible(false)
    options.owner.contentView.addChildView(view)
    this.#records.set(options.key, record)
    this.#trackOwner(options.owner)
    options.onAttach?.(wc)
    void wc.loadURL(options.homeUrl)
    return record
  }

  #allows(options: ViewOptions, url: string): boolean {
    return allowedBaseUrl(url) && (options.allowsNavigation?.(url) ?? true)
  }

  #emit(record: ViewRecord, loading: boolean): void {
    if (record.owner.isDestroyed()) return
    const wc = record.view.webContents
    record.options.onState?.({
      key: record.options.key,
      url: wc.getURL(),
      loading,
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
    })
  }

  #trackOwner(owner: BrowserWindow): void {
    if (this.#trackedOwners.has(owner)) return
    this.#trackedOwners.add(owner)
    owner.once('closed', () => {
      for (const [key, record] of this.#records) if (record.owner === owner) this.evict(key)
    })
  }
}
