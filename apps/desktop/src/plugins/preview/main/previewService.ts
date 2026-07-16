// Browser-preview surface (docs/panes.md): a main-owned WebContentsView per task, not a
// renderer <webview>. The <webview> tag is on Electron's deprecation trajectory and
// forced the old body-parented floating layer — a DOM-embedded guest is reloaded whenever it leaves
// and re-enters the DOM, so surviving pane switches was a hack. A WebContentsView is main-owned and
// bounds-managed: surviving pane/task switches is its natural behaviour. The renderer drives it over
// IPC (create/bounds/show/navigate) and gets chrome state (loading, url, back/forward) pushed back.
//
// Occlusion caveat: a native view always paints above the window's web content, so overlays can't
// sit above it via z-index. The renderer detects when an overlay covers the pane and calls hide()
// (PreviewPane.tsx) — the WebContentsView equivalent of the old z-index dance.
import { BrowserWindow, WebContentsView, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { bindBrowserContents, unbindBrowserContents } from './browserService'
import { isAllowedPreviewUrl } from './browserAuto'

type Rect = { x: number; y: number; width: number; height: number }
type PreviewState = { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
type PreviewRecord = { view: WebContentsView; owner: BrowserWindow; homeUrl: string }

const previews = new Map<string, PreviewRecord>()
const trackedOwners = new WeakSet<BrowserWindow>()

function stateOf(taskId: string, wc: WebContents, loading: boolean): PreviewState {
  return { taskId, url: wc.getURL(), loading, canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward() }
}

function emit(record: PreviewRecord, state: PreviewState): void {
  if (!record.owner.isDestroyed()) record.owner.webContents.send('preview:event', state)
}

function trackOwner(owner: BrowserWindow): void {
  if (trackedOwners.has(owner)) return
  trackedOwners.add(owner)
  owner.once('closed', () => {
    for (const [taskId, record] of previews) {
      if (record.owner === owner) evict(taskId)
    }
  })
}

function create(taskId: string, owner: BrowserWindow, homeUrl: string): PreviewRecord {
  // Hardened guest: no preload, no node integration, sandboxed — same posture the old
  // will-attach-webview handler pinned on the <webview>.
  const view = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } })
  const wc = view.webContents
  const record = { view, owner, homeUrl }
  // Carry the http(s)-only / no-userinfo restriction (feature-parity §13): block in-page navigations
  // to anything else, and deny window.open outright (preview has no business spawning windows).
  wc.on('will-navigate', (e, url) => { if (!isAllowedPreviewUrl(url)) e.preventDefault() })
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('did-start-loading', () => emit(record, stateOf(taskId, wc, true)))
  wc.on('did-stop-loading', () => emit(record, stateOf(taskId, wc, false)))
  wc.on('did-navigate', () => emit(record, stateOf(taskId, wc, wc.isLoading())))
  wc.on('did-navigate-in-page', () => emit(record, stateOf(taskId, wc, wc.isLoading())))

  view.setVisible(false) // shown once the renderer sets bounds and this pane is active
  owner.contentView.addChildView(view)
  previews.set(taskId, record)
  trackOwner(owner)
  // Agent driving (docs/panes.md): main owns the contents, so it binds the CDP driver directly — no
  // renderer round-trip with a webContents id. `browser:bind` is gone; what the agent drives is what
  // the user sees (feature-parity §13).
  bindBrowserContents(taskId, wc)
  if (isAllowedPreviewUrl(homeUrl)) void wc.loadURL(homeUrl)
  return record
}

function evict(taskId: string): void {
  const record = previews.get(taskId)
  if (!record) return
  previews.delete(taskId)
  const wc = record.view.webContents
  unbindBrowserContents(taskId, wc)
  try {
    record.owner.contentView.removeChildView(record.view)
  } catch {
    /* owner already closed or view already detached */
  }
  try {
    if (!wc.isDestroyed()) wc.close() // free the guest renderer process
  } catch {
    /* already closed */
  }
}

// --- Task-id-addressed controller for the public API (docs/public-api.md). Operates on
// the existing preview record for a task; never accepts/returns a raw webContents id or CDP handle.
// A bounds/show/hide-free surface — those stay renderer-owned. ---

export function previewCurrentUrl(taskId: string): string | null {
  const r = previews.get(taskId)
  return r && !r.view.webContents.isDestroyed() ? r.view.webContents.getURL() : null
}

export function previewLoadUrl(taskId: string, url: string): boolean {
  const r = previews.get(taskId)
  if (!r || !isAllowedPreviewUrl(url)) return false
  void r.view.webContents.loadURL(url)
  return true
}

export function previewNavigate(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop'): boolean {
  const wc = previews.get(taskId)?.view.webContents
  if (!wc) return false
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
  else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
  else if (action === 'reload') wc.reload()
  else if (action === 'stop') wc.stop()
  return true
}

export function previewNavState(taskId: string): { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean } | null {
  const wc = previews.get(taskId)?.view.webContents
  if (!wc || wc.isDestroyed()) return null
  return { url: wc.getURL(), canGoBack: wc.navigationHistory.canGoBack(), canGoForward: wc.navigationHistory.canGoForward(), loading: wc.isLoading() }
}

export function previewEvictTask(taskId: string): boolean {
  if (!previews.has(taskId)) return false
  evict(taskId)
  return true
}

// Registered by the composition root (bootstrap.ts). Returns a disposer that drops every view.
export function registerPreviewIpc(): () => void {
  const winOf = (e: IpcMainInvokeEvent | IpcMainEvent) => BrowserWindow.fromWebContents(e.sender)
  const ownedRecord = (e: IpcMainInvokeEvent | IpcMainEvent, taskId: unknown): PreviewRecord | null => {
    const owner = winOf(e)
    const record = typeof taskId === 'string' ? previews.get(taskId) : undefined
    return owner && record?.owner === owner ? record : null
  }

  const onEnsure = (e: IpcMainInvokeEvent, p: { taskId: string; url: string }) => {
    const owner = winOf(e)
    if (!owner || typeof p?.taskId !== 'string' || typeof p?.url !== 'string' || !isAllowedPreviewUrl(p.url)) return false
    let record = previews.get(p.taskId)
    if (record && (record.owner !== owner || record.view.webContents.isDestroyed())) {
      evict(p.taskId)
      record = undefined
    }
    if (!record) create(p.taskId, owner, p.url)
    else if (record.homeUrl !== p.url) {
      record.homeUrl = p.url
      void record.view.webContents.loadURL(p.url)
    }
    return true
  }
  const onBounds = (e: IpcMainEvent, p: { taskId: string; rect: Rect }) => {
    const record = ownedRecord(e, p?.taskId)
    const rect = p?.rect
    if (!record || !rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite)) return
    record.view.setBounds({
      x: Math.round(rect.x), y: Math.round(rect.y),
      width: Math.max(0, Math.round(rect.width)), height: Math.max(0, Math.round(rect.height)),
    })
  }
  const onShow = (e: IpcMainEvent, p: { taskId: string }) => {
    const owner = winOf(e)
    if (!owner) return
    for (const [id, record] of previews) {
      if (record.owner === owner) record.view.setVisible(id === p?.taskId)
    }
    const record = ownedRecord(e, p?.taskId)
    if (record) emit(record, stateOf(p.taskId, record.view.webContents, record.view.webContents.isLoading()))
  }
  const onHide = (e: IpcMainEvent) => {
    const owner = winOf(e)
    if (!owner) return
    for (const record of previews.values()) {
      if (record.owner === owner) record.view.setVisible(false)
    }
  }
  const onLoad = (e: IpcMainEvent, p: { taskId: string; url: string }) => {
    const record = ownedRecord(e, p?.taskId)
    if (record && isAllowedPreviewUrl(p.url)) void record.view.webContents.loadURL(p.url)
  }
  const onCommand = (e: IpcMainEvent, p: { taskId: string; action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools' }) => {
    const wc = ownedRecord(e, p?.taskId)?.view.webContents
    if (!wc) return
    if (p.action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
    else if (p.action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
    else if (p.action === 'reload') wc.reload()
    else if (p.action === 'stop') wc.stop()
    // Detached: a WebContentsView has no window chrome of its own to dock devtools into.
    else if (p.action === 'devtools') wc.isDevToolsOpened() ? wc.closeDevTools() : wc.openDevTools({ mode: 'detach' })
  }
  const onEvict = (e: IpcMainEvent, p: { taskId: string }) => {
    if (ownedRecord(e, p?.taskId)) evict(p.taskId)
  }

  ipcMain.handle('preview:ensure', onEnsure)
  ipcMain.on('preview:bounds', onBounds)
  ipcMain.on('preview:show', onShow)
  ipcMain.on('preview:hide', onHide)
  ipcMain.on('preview:load', onLoad)
  ipcMain.on('preview:command', onCommand)
  ipcMain.on('preview:evict', onEvict)

  return () => {
    ipcMain.removeHandler('preview:ensure')
    ipcMain.removeListener('preview:bounds', onBounds)
    ipcMain.removeListener('preview:show', onShow)
    ipcMain.removeListener('preview:hide', onHide)
    ipcMain.removeListener('preview:load', onLoad)
    ipcMain.removeListener('preview:command', onCommand)
    ipcMain.removeListener('preview:evict', onEvict)
    for (const taskId of [...previews.keys()]) evict(taskId)
  }
}
