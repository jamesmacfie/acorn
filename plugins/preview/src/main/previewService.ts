// Preview's thin Electron adapter over the host-owned view service. Preview still owns its page
// rules, tunnel headers and CDP binding; native view lifecycle and session isolation are shared.
import { createRequire } from 'node:module'
import type { BrowserWindow, IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { matchesUrlPattern } from '@acorn/protocol/browserRules.ts'
import type { PreviewBrowserRule } from '@acorn/protocol/serviceProtocol.ts'
import { bindBrowserContents, unbindBrowserContents } from './browserService'
import { buildFillScript, isAllowedPreviewUrl } from './browserAuto'

type Rect = { x: number; y: number; width: number; height: number }
type PreviewState = { taskId: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }
type RulesForTask = (taskId: string) => Promise<PreviewBrowserRule[]>
type TunnelHeadersFor = (url: string) => Record<string, string> | null
type ViewState = { key: string; url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean }

// Structural on purpose: a feature package may not import apps/desktop. The composition root supplies
// apps/desktop's WebviewService, while focused tests can supply the same narrow contract.
export type PreviewViewService = {
  ensure(options: {
    key: string
    owner: BrowserWindow
    homeUrl: string
    partitionKey?: string
    headersFor?: TunnelHeadersFor
    onAttach?: (contents: WebContents) => void
    onDetach?: (contents: WebContents) => void
    onState?: (state: ViewState) => void
    onDomReady?: (contents: WebContents) => void | Promise<void>
    allowsNavigation?: (url: string) => boolean
  }): boolean
  setBounds(owner: BrowserWindow, key: string, rect: Rect): boolean
  show(owner: BrowserWindow, key: string): boolean
  hideMatching(owner: BrowserWindow, predicate: (key: string) => boolean): void
  load(owner: BrowserWindow, key: string, url: string): boolean
  command(owner: BrowserWindow, key: string, action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools'): boolean
  currentUrl(key: string): string | null
  navigationState(key: string): { url: string; loading: boolean; canGoBack: boolean; canGoForward: boolean } | null
  loadByKey(key: string, url: string): boolean
  commandByKey(key: string, action: 'back' | 'forward' | 'reload' | 'stop'): boolean
  evictOwned(owner: BrowserWindow, key: string): boolean
  evict(key: string): boolean
  evictMatching(predicate: (key: string) => boolean): void
}

// `electron` is resolved when registerPreviewIpc is CALLED, not when this module is imported — the
// same treatment plugins/terminal/src/main/folderPickerIpc.ts gets, for the same reason. A barrel
// evaluates every module on it, so a static `import { BrowserWindow, ipcMain } from 'electron'` here
// makes main/index.ts unloadable outside Electron: Node's ESM linker fails on the named exports of
// electron's CommonJS shim before a line of it runs. The types stay static (they are erased), and only
// calling this needs a desktop. apps/node/test/integration/mainBarrelLoad.test.ts loads the barrel in
// plain Node and fails if a static value import comes back.
const electron = () => createRequire(import.meta.url)('electron') as typeof import('electron')

const previewKey = (taskId: string): string => `preview:${taskId}`
const isPreviewKey = (key: string): boolean => key.startsWith('preview:')
let activeService: PreviewViewService | undefined

async function applyLoadRules(taskId: string, wc: WebContents, loadRules: RulesForTask | undefined): Promise<void> {
  if (!loadRules) return
  const url = wc.getURL()
  if (!isAllowedPreviewUrl(url)) return
  const rules = await loadRules(taskId).catch((error) => {
    console.warn('[preview] page rule lookup failed:', error)
    return []
  })
  if (wc.isDestroyed() || wc.getURL() !== url) return
  for (const rule of rules) {
    if (!rule.enabled || rule.trigger !== 'load' || rule.action.type !== 'fill') continue
    if (!matchesUrlPattern(url, rule.urlPattern)) continue
    wc.executeJavaScript(buildFillScript(rule.action.selector, rule.action.value)).catch((error) => {
      console.warn('[preview] page rule failed:', error)
    })
  }
}

export function previewCurrentUrl(taskId: string): string | null {
  return activeService?.currentUrl(previewKey(taskId)) ?? null
}

export function previewLoadUrl(taskId: string, url: string): boolean {
  return !!activeService && isAllowedPreviewUrl(url) && activeService.loadByKey(previewKey(taskId), url)
}

export function previewNavigate(taskId: string, action: 'back' | 'forward' | 'reload' | 'stop'): boolean {
  return activeService?.commandByKey(previewKey(taskId), action) ?? false
}

export function previewNavState(taskId: string): { url: string; canGoBack: boolean; canGoForward: boolean; loading: boolean } | null {
  return activeService?.navigationState(previewKey(taskId)) ?? null
}

export function previewEvictTask(taskId: string): boolean {
  return activeService?.evict(previewKey(taskId)) ?? false
}

export function registerPreviewIpc(deps: {
  viewService: PreviewViewService
  rulesForTask?: RulesForTask
  tunnelHeadersFor?: TunnelHeadersFor
}): () => void {
  const { viewService, rulesForTask, tunnelHeadersFor } = deps
  activeService = viewService
  const { BrowserWindow: browserWindow, ipcMain } = electron()
  const winOf = (event: IpcMainInvokeEvent | IpcMainEvent) => browserWindow.fromWebContents(event.sender)
  const emit = (owner: BrowserWindow, taskId: string, state: ViewState): void => {
    if (owner.isDestroyed()) return
    const payload: PreviewState = { taskId, url: state.url, loading: state.loading, canGoBack: state.canGoBack, canGoForward: state.canGoForward }
    owner.webContents.send('preview:event', payload)
  }

  const onEnsure = (event: IpcMainInvokeEvent, payload: { taskId: string; url: string }) => {
    const owner = winOf(event)
    if (!owner || typeof payload?.taskId !== 'string' || typeof payload?.url !== 'string' || !isAllowedPreviewUrl(payload.url)) return false
    const taskId = payload.taskId
    return viewService.ensure({
      key: previewKey(taskId),
      owner,
      homeUrl: payload.url,
      partitionKey: `acorn-preview-${encodeURIComponent(taskId)}`,
      headersFor: tunnelHeadersFor,
      allowsNavigation: isAllowedPreviewUrl,
      onAttach: (contents) => bindBrowserContents(taskId, contents),
      onDetach: (contents) => unbindBrowserContents(taskId, contents),
      onState: (state) => emit(owner, taskId, state),
      onDomReady: (contents) => applyLoadRules(taskId, contents, rulesForTask),
    })
  }
  const onBounds = (event: IpcMainEvent, payload: { taskId: string; rect: Rect }) => {
    const owner = winOf(event)
    if (owner && typeof payload?.taskId === 'string' && payload.rect) {
      viewService.setBounds(owner, previewKey(payload.taskId), payload.rect)
    }
  }
  const onShow = (event: IpcMainEvent, payload: { taskId: string }) => {
    const owner = winOf(event)
    if (!owner || typeof payload?.taskId !== 'string') return
    viewService.hideMatching(owner, isPreviewKey)
    viewService.show(owner, previewKey(payload.taskId))
  }
  const onHide = (event: IpcMainEvent) => {
    const owner = winOf(event)
    if (owner) viewService.hideMatching(owner, isPreviewKey)
  }
  const onLoad = (event: IpcMainEvent, payload: { taskId: string; url: string }) => {
    const owner = winOf(event)
    if (owner && typeof payload?.taskId === 'string' && typeof payload?.url === 'string' && isAllowedPreviewUrl(payload.url)) {
      viewService.load(owner, previewKey(payload.taskId), payload.url)
    }
  }
  const onCommand = (event: IpcMainEvent, payload: { taskId: string; action: 'back' | 'forward' | 'reload' | 'stop' | 'devtools' }) => {
    const owner = winOf(event)
    if (owner && typeof payload?.taskId === 'string') viewService.command(owner, previewKey(payload.taskId), payload.action)
  }
  const onEvict = (event: IpcMainEvent, payload: { taskId: string }) => {
    const owner = winOf(event)
    if (owner && typeof payload?.taskId === 'string') viewService.evictOwned(owner, previewKey(payload.taskId))
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
    viewService.evictMatching(isPreviewKey)
    if (activeService === viewService) activeService = undefined
  }
}
