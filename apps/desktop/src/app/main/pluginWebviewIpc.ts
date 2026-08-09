import { BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import {
  isAllowedWebviewUrl,
  normalizeWebviewHost,
  WEBVIEW_HOST_MAX_COUNT,
  WEBVIEW_HOST_MAX_LENGTH,
} from '@acorn/protocol/webview.ts'
import type { WebviewService } from './webviewService'

const PLUGIN_KEY = /^plugin:[^:]+:[^:]+(?::[^:]+)?$/
const keySchema = z.string().max(512).regex(PLUGIN_KEY)
const hostSchema = z.string().min(1).max(WEBVIEW_HOST_MAX_LENGTH).refine((value) => {
  try {
    normalizeWebviewHost(value)
    return true
  } catch {
    return false
  }
}, 'invalid webview host')
const ensureSchema = z.strictObject({
  key: keySchema,
  url: z.string().min(1).max(2_048),
  hosts: z.array(hostSchema).min(1).max(WEBVIEW_HOST_MAX_COUNT),
})
const keyedSchema = z.strictObject({ key: keySchema })
const boundsSchema = keyedSchema.extend({
  rect: z.strictObject({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite() }),
})
const loadSchema = keyedSchema.extend({ url: z.string().min(1).max(2_048) })
const commandSchema = keyedSchema.extend({ action: z.enum(['back', 'forward', 'reload']) })

const sessionKey = (key: string): string => key.split(':').slice(0, 3).join(':')

export function registerPluginWebviewIpc(webviews: WebviewService): () => void {
  const winOf = (event: IpcMainInvokeEvent | IpcMainEvent) => BrowserWindow.fromWebContents(event.sender)

  const onEnsure = (event: IpcMainInvokeEvent, raw: unknown): boolean => {
    const parsed = ensureSchema.safeParse(raw)
    const owner = winOf(event)
    if (!parsed.success || !owner || !isAllowedWebviewUrl(parsed.data.url, parsed.data.hosts)) return false
    const { key, url, hosts } = parsed.data
    return webviews.ensure({
      key,
      owner,
      homeUrl: url,
      partitionKey: `acorn-webview-${encodeURIComponent(sessionKey(key))}`,
      allowsNavigation: (candidate) => isAllowedWebviewUrl(candidate, hosts),
      onState: (state) => {
        if (!owner.isDestroyed()) owner.webContents.send('plugin-webview:event', state)
      },
      onBlocked: ({ key: blockedKey, url: blockedUrl, host }) => {
        if (!owner.isDestroyed()) owner.webContents.send('plugin-webview:blocked', { key: blockedKey, url: blockedUrl, host })
      },
    })
  }
  const onBounds = (event: IpcMainEvent, raw: unknown) => {
    const parsed = boundsSchema.safeParse(raw)
    const owner = winOf(event)
    if (parsed.success && owner) webviews.setBounds(owner, parsed.data.key, parsed.data.rect)
  }
  const onShow = (event: IpcMainEvent, raw: unknown) => {
    const parsed = keyedSchema.safeParse(raw)
    const owner = winOf(event)
    if (parsed.success && owner) webviews.show(owner, parsed.data.key)
  }
  const onHide = (event: IpcMainEvent, raw: unknown) => {
    const parsed = keyedSchema.safeParse(raw)
    const owner = winOf(event)
    if (parsed.success && owner) webviews.hide(owner, parsed.data.key)
  }
  const onLoad = (event: IpcMainInvokeEvent, raw: unknown): boolean => {
    const parsed = loadSchema.safeParse(raw)
    const owner = winOf(event)
    return !!(parsed.success && owner && webviews.load(owner, parsed.data.key, parsed.data.url))
  }
  const onCommand = (event: IpcMainInvokeEvent, raw: unknown): boolean => {
    const parsed = commandSchema.safeParse(raw)
    const owner = winOf(event)
    return !!(parsed.success && owner && webviews.command(owner, parsed.data.key, parsed.data.action))
  }
  const onEvict = (event: IpcMainEvent, raw: unknown) => {
    const parsed = keyedSchema.safeParse(raw)
    const owner = winOf(event)
    if (parsed.success && owner) webviews.evictOwned(owner, parsed.data.key)
  }

  ipcMain.handle('plugin-webview:ensure', onEnsure)
  ipcMain.on('plugin-webview:bounds', onBounds)
  ipcMain.on('plugin-webview:show', onShow)
  ipcMain.on('plugin-webview:hide', onHide)
  ipcMain.handle('plugin-webview:load', onLoad)
  ipcMain.handle('plugin-webview:command', onCommand)
  ipcMain.on('plugin-webview:evict', onEvict)

  return () => {
    ipcMain.removeHandler('plugin-webview:ensure')
    ipcMain.removeListener('plugin-webview:bounds', onBounds)
    ipcMain.removeListener('plugin-webview:show', onShow)
    ipcMain.removeListener('plugin-webview:hide', onHide)
    ipcMain.removeHandler('plugin-webview:load')
    ipcMain.removeHandler('plugin-webview:command')
    ipcMain.removeListener('plugin-webview:evict', onEvict)
    webviews.evictMatching((key) => PLUGIN_KEY.test(key))
  }
}
